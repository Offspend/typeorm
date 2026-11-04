import "reflect-metadata"
import { expect } from "chai"
import {
    closeTestingConnections,
    createTestingConnections,
} from "../../utils/test-utils"
import { DataSource, DefaultNamingStrategy } from "../../../src"
import { RowLevelSecurityPolicyMetadata } from "../../../src/metadata/RowLevelSecurityMetadata"
import { RowLevelSecurityPolicyMetadataArgs } from "../../../src/metadata-args/RowLevelSecurityPolicyMetadataArgs"
import { OptionalCompanyScoped } from "./entity/OptionalCompanyScoped"

describe("github issues > #11111 Row Level Security policy command", () => {
    describe("command expansion", () => {
        const args = (
            command: any,
            name?: string,
        ): RowLevelSecurityPolicyMetadataArgs => ({
            target: OptionalCompanyScoped,
            expression: "TRUE",
            command,
            name,
        })

        it("should keep a policy without command or with a single command as is", () => {
            for (const command of [undefined, "all", "select", "insert"]) {
                const expanded = RowLevelSecurityPolicyMetadata.expandArgs(
                    args(command, "my_policy"),
                    "Entity",
                )
                expect(expanded).to.have.length(1)
                expect(expanded[0].command).to.equal(command)
                expect(expanded[0].name).to.equal("my_policy")
            }
        })

        it("should expand a list of commands into one policy per command", () => {
            const expanded = RowLevelSecurityPolicyMetadata.expandArgs(
                args(["insert", "update", "delete"]),
                "Entity",
            )
            expect(expanded.map((e) => e.command)).to.eql([
                "insert",
                "update",
                "delete",
            ])
            expect(expanded.map((e) => e.name)).to.eql([
                undefined,
                undefined,
                undefined,
            ])
        })

        it("should suffix the given name with the command when expanding several commands", () => {
            const expanded = RowLevelSecurityPolicyMetadata.expandArgs(
                args(["insert", "update"], "company_write"),
                "Entity",
            )
            expect(expanded.map((e) => e.name)).to.eql([
                "company_write_insert",
                "company_write_update",
            ])
        })

        it("should keep the given name for a list with a single command", () => {
            const expanded = RowLevelSecurityPolicyMetadata.expandArgs(
                args(["insert"], "company_write"),
                "Entity",
            )
            expect(expanded.map((e) => e.name)).to.eql(["company_write"])
        })

        it("should reject invalid commands", () => {
            const invalid: [any, RegExp][] = [
                ["read", /unknown command "read"/],
                [[], /empty list/],
                [["all", "select"], /invalid command "all"/],
                [["select", "read"], /invalid command "read"/],
                [["insert", "insert"], /"insert" more than once/],
            ]
            for (const [command, message] of invalid) {
                expect(() =>
                    RowLevelSecurityPolicyMetadata.expandArgs(
                        args(command),
                        "Entity",
                    ),
                ).to.throw(message)
            }
        })

        it("should not change the name of policies without command", () => {
            const naming = new DefaultNamingStrategy()
            const legacy = naming.rowLevelSecurityPolicyName(
                "tenant",
                "TRUE",
                "role",
                "restrictive",
            )
            expect(
                naming.rowLevelSecurityPolicyName(
                    "tenant",
                    "TRUE",
                    "role",
                    "restrictive",
                    "all",
                ),
            ).to.equal(legacy)
            const names = (["select", "insert", "update", "delete"] as const)
                .map((command) =>
                    naming.rowLevelSecurityPolicyName(
                        "tenant",
                        "TRUE",
                        "role",
                        "restrictive",
                        command,
                    ),
                )
                .concat(legacy)
            expect(new Set(names).size).to.equal(5)
        })
    })

    describe("synchronization and behaviour", () => {
        let dataSources: DataSource[]
        const role = "company_rw_user"
        const table = "optional_company_scoped"

        before(async () => {
            dataSources = await createTestingConnections({
                entities: [OptionalCompanyScoped],
                enabledDrivers: ["postgres"],
                schemaCreate: false,
                dropSchema: true,
            })
            for (const dataSource of dataSources) {
                await dataSource.query(`DROP ROLE IF EXISTS ${role}`)
                await dataSource.query(`CREATE ROLE ${role}`)
            }
        })
        beforeEach(async () => {
            for (const dataSource of dataSources) {
                await dataSource.dropDatabase()
                await dataSource.synchronize()
                await dataSource.query(
                    `GRANT SELECT, INSERT, UPDATE, DELETE ON "${table}" TO ${role}`,
                )
                await dataSource.query(
                    `INSERT INTO "${table}" ("id", "companyId") VALUES (1, 'A'), (2, NULL), (3, 'B')`,
                )
            }
        })
        after(async () => {
            for (const dataSource of dataSources) {
                await dataSource.dropDatabase()
                await dataSource.query(`DROP ROLE IF EXISTS ${role}`)
            }
            await closeTestingConnections(dataSources)
        })

        const forEachDataSource = (fn: (ds: DataSource) => Promise<void>) =>
            Promise.all(dataSources.map(fn))

        const policies = (dataSource: DataSource) =>
            dataSource.query(
                `SELECT policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE tablename = '${table}' ORDER BY cmd, policyname`,
            )

        /** Runs queries as the restricted role, acting for the given company. */
        const asCompany = async (
            dataSource: DataSource,
            company: string,
            fn: (query: (sql: string) => Promise<any>) => Promise<void>,
        ) => {
            const queryRunner = dataSource.createQueryRunner()
            try {
                await queryRunner.query(`SET ROLE ${role}`)
                await queryRunner.query(
                    `SELECT set_config('app.company_id', '${company}', false)`,
                )
                await fn(async (sql) => {
                    const result = await queryRunner.query(sql)
                    // UPDATE and DELETE resolve to [rows, affectedCount]
                    return Array.isArray(result) &&
                        typeof result[1] === "number"
                        ? result[0]
                        : result
                })
            } finally {
                await queryRunner.query(`RESET ROLE`)
                await queryRunner.query(`RESET app.company_id`)
                await queryRunner.release()
            }
        }

        const ids = (rows: any[]) => rows.map((row) => row.id)

        it("should create one policy per command with the right clause", () =>
            forEachDataSource(async (dataSource) => {
                const result = await policies(dataSource)
                const restrictive = result.filter(
                    (p: any) => p.permissive === "RESTRICTIVE",
                )
                expect(restrictive.map((p: any) => p.cmd).sort()).to.eql([
                    "DELETE",
                    "INSERT",
                    "SELECT",
                    "UPDATE",
                ])

                for (const policy of restrictive) {
                    expect(policy.roles).to.equal(`{${role}}`)
                    if (policy.cmd === "INSERT") {
                        // INSERT policies only have WITH CHECK
                        expect(policy.qual).to.equal(null)
                        expect(policy.with_check).to.contain("companyId")
                    } else {
                        expect(policy.qual).to.contain("companyId")
                    }
                }
                // the permissive TRUE policy is still a plain FOR ALL
                const permissive = result.filter(
                    (p: any) => p.permissive === "PERMISSIVE",
                )
                expect(permissive.map((p: any) => p.cmd)).to.eql(["ALL"])
            }))

        it("should not generate queries when already synchronized", () =>
            forEachDataSource(async (dataSource) => {
                const sqlInMemory = await dataSource.driver
                    .createSchemaBuilder()
                    .log()
                expect(sqlInMemory.upQueries).to.have.length(0)
                expect(sqlInMemory.downQueries).to.have.length(0)
            }))

        it("should recreate a dropped policy with its command on down migration", () =>
            forEachDataSource(async (dataSource) => {
                const before = await policies(dataSource)
                const queryRunner = dataSource.createQueryRunner()
                try {
                    const loadedTable = await queryRunner.getTable(table)
                    // the loader must read command and WITH CHECK back from the database
                    const insertPolicy =
                        loadedTable!.rowLevelSecurityPolicies.find(
                            (p) => p.command === "insert",
                        )
                    expect(insertPolicy).to.not.equal(undefined)
                    expect(insertPolicy!.expression).to.contain("companyId")

                    for (const policy of loadedTable!.rowLevelSecurityPolicies.filter(
                        (p) => p.command !== "all",
                    ))
                        await queryRunner.dropRowLevelSecurityPolicy(
                            loadedTable!,
                            policy,
                        )
                    expect(
                        (await policies(dataSource)).filter(
                            (p: any) => p.permissive === "RESTRICTIVE",
                        ),
                    ).to.have.length(0)

                    await queryRunner.executeMemoryDownSql()
                } finally {
                    await queryRunner.release()
                }
                expect(await policies(dataSource)).to.eql(before)
            }))

        it("should let a company read its rows and the public rows only", () =>
            forEachDataSource(async (dataSource) => {
                await asCompany(dataSource, "A", async (query) => {
                    expect(
                        ids(
                            await query(
                                `SELECT id FROM "${table}" ORDER BY id`,
                            ),
                        ),
                    ).to.eql([1, 2])
                })
            }))

        it("should let a company insert rows for itself only", () =>
            forEachDataSource(async (dataSource) => {
                await asCompany(dataSource, "A", async (query) => {
                    await query(
                        `INSERT INTO "${table}" ("id", "companyId") VALUES (10, 'A')`,
                    )
                    for (const company of ["NULL", "'B'"])
                        await expect(
                            query(
                                `INSERT INTO "${table}" ("id", "companyId") VALUES (11, ${company})`,
                            ),
                        ).to.be.rejectedWith(/row-level security policy/)
                })
            }))

        it("should let a company update its own rows but not public rows", () =>
            forEachDataSource(async (dataSource) => {
                await asCompany(dataSource, "A", async (query) => {
                    expect(
                        ids(
                            await query(
                                `UPDATE "${table}" SET "id" = 1 WHERE id = 1 RETURNING id`,
                            ),
                        ),
                    ).to.eql([1])

                    // public rows are neither modified nor claimed
                    for (const companyId of ["NULL", "'A'"])
                        expect(
                            await query(
                                `UPDATE "${table}" SET "companyId" = ${companyId} WHERE id = 2 RETURNING id`,
                            ),
                        ).to.eql([])

                    // an own row cannot be moved to another company or made public
                    for (const companyId of ["NULL", "'B'"])
                        await expect(
                            query(
                                `UPDATE "${table}" SET "companyId" = ${companyId} WHERE id = 1`,
                            ),
                        ).to.be.rejectedWith(/row-level security policy/)
                })
            }))

        it("should let a company delete its own rows but not public rows", () =>
            forEachDataSource(async (dataSource) => {
                await asCompany(dataSource, "A", async (query) => {
                    expect(
                        await query(
                            `DELETE FROM "${table}" WHERE id = 2 RETURNING id`,
                        ),
                    ).to.eql([])
                    expect(
                        ids(
                            await query(
                                `DELETE FROM "${table}" WHERE id = 1 RETURNING id`,
                            ),
                        ),
                    ).to.eql([1])
                })
                // nothing else has been deleted
                expect(
                    ids(
                        await dataSource.query(
                            `SELECT id FROM "${table}" ORDER BY id`,
                        ),
                    ),
                ).to.eql([2, 3])
            }))
    })
})

import "reflect-metadata"
import { expect } from "chai"
import { DataSource } from "../../../src"
import {
    asRole,
    COMPANY_ROLE,
    createCompanyScopedDataSources,
    dropCompanyScoped,
    UNRESTRICTED_ROLE,
} from "./company-scoped"
import { JoinCompany } from "./entity/JoinCompany"
import { JoinUser } from "./entity/JoinUser"

const JUNCTION = "join_company_users"

/**
 * Rows of the junction table: company A -> user 1, company B -> user 2.
 */
describe("github issues > #11111 Row Level Security on a join table", () => {
    let dataSources: DataSource[]

    before(
        async () =>
            (dataSources = await createCompanyScopedDataSources([
                JoinCompany,
                JoinUser,
            ])),
    )
    beforeEach(async () => {
        for (const dataSource of dataSources) {
            await dataSource.dropDatabase()
            await dataSource.synchronize()
            for (const role of [COMPANY_ROLE, UNRESTRICTED_ROLE])
                await dataSource.query(
                    `GRANT SELECT, INSERT, UPDATE, DELETE ON "${JUNCTION}" TO ${role}`,
                )
            for (const role of [COMPANY_ROLE, UNRESTRICTED_ROLE])
                await dataSource.query(`GRANT SELECT ON "join_user" TO ${role}`)
            await dataSource.query(
                `INSERT INTO "join_company" ("id") VALUES ('A'), ('B')`,
            )
            await dataSource.query(
                `INSERT INTO "join_user" ("id") VALUES (1), (2), (3)`,
            )
            await dataSource.query(
                `INSERT INTO "${JUNCTION}" ("companyId", "userId") VALUES ('A', 1), ('B', 2)`,
            )
        }
    })
    after(() => dropCompanyScoped(dataSources))

    const forEachDataSource = (fn: (ds: DataSource) => Promise<void>) =>
        Promise.all(dataSources.map(fn))

    const REJECTED = /row-level security policy/

    describe("schema", () => {
        it("should enable row level security and create the policies on the junction table", () =>
            forEachDataSource(async (dataSource) => {
                const [table] = await dataSource.query(
                    `SELECT relrowsecurity FROM pg_class WHERE relname = '${JUNCTION}'`,
                )
                expect(table.relrowsecurity).to.equal(true)

                const policies = await dataSource.query(
                    `SELECT permissive, roles, cmd, qual FROM pg_policies WHERE tablename = '${JUNCTION}' ORDER BY permissive`,
                )
                expect(policies).to.have.length(2)
                expect(policies.map((p: any) => p.permissive)).to.eql([
                    "PERMISSIVE",
                    "RESTRICTIVE",
                ])
                expect(policies[1].roles).to.equal(`{${COMPANY_ROLE}}`)
                expect(policies[1].qual).to.contain("companyId")
            }))

        it("should not generate queries when already synchronized", () =>
            forEachDataSource(async (dataSource) => {
                const sqlInMemory = await dataSource.driver
                    .createSchemaBuilder()
                    .log()
                expect(sqlInMemory.upQueries).to.have.length(0)
                expect(sqlInMemory.downQueries).to.have.length(0)
            }))

        it("should load the policies of the junction table", () =>
            forEachDataSource(async (dataSource) => {
                const queryRunner = dataSource.createQueryRunner()
                try {
                    const table = await queryRunner.getTable(JUNCTION)
                    expect(table!.rowLevelSecurity).to.not.equal(undefined)
                    expect(
                        table!.rowLevelSecurityPolicies.map((p) => p.command),
                    ).to.eql(["all", "all"])
                } finally {
                    await queryRunner.release()
                }
            }))

        it("should drop the policies and disable row level security when the options are removed", () =>
            forEachDataSource(async (dataSource) => {
                const junction = dataSource.entityMetadatas.find(
                    (metadata) => metadata.tableName === JUNCTION,
                )!
                const { rowLevelSecurity, rowLevelSecurityPolicies } = junction
                junction.rowLevelSecurity = undefined
                junction.rowLevelSecurityPolicies = []

                let table: any
                try {
                    await dataSource.synchronize()
                    ;[table] = await dataSource.query(
                        `SELECT relrowsecurity FROM pg_class WHERE relname = '${JUNCTION}'`,
                    )
                } finally {
                    // the metadata is shared with the following tests
                    junction.rowLevelSecurity = rowLevelSecurity
                    junction.rowLevelSecurityPolicies = rowLevelSecurityPolicies
                }
                expect(table.relrowsecurity).to.equal(false)
                expect(
                    await dataSource.query(
                        `SELECT 1 FROM pg_policies WHERE tablename = '${JUNCTION}'`,
                    ),
                ).to.have.length(0)
            }))
    })

    describe("behaviour", () => {
        const links = async (
            query: (sql: string) => Promise<any>,
        ): Promise<string[]> =>
            (
                await query(
                    `SELECT "companyId", "userId" FROM "${JUNCTION}" ORDER BY "userId"`,
                )
            ).map((row: any) => `${row.companyId}:${row.userId}`)

        it("should only return the links of the current company", () =>
            forEachDataSource((dataSource) =>
                asRole(dataSource, COMPANY_ROLE, "A", async (query) => {
                    expect(await links(query)).to.eql(["A:1"])
                }),
            ))

        it("should return no link when no company is set", () =>
            forEachDataSource((dataSource) =>
                asRole(dataSource, COMPANY_ROLE, null, async (query) => {
                    expect(await links(query)).to.eql([])
                }),
            ))

        it("should only return the users linked to the current company when joining from the inverse side", () =>
            forEachDataSource((dataSource) =>
                asRole(dataSource, COMPANY_ROLE, "A", async (query) => {
                    const rows = await query(
                        `SELECT u.id FROM "join_user" u JOIN "${JUNCTION}" j ON j."userId" = u.id ORDER BY u.id`,
                    )
                    expect(rows.map((row: any) => row.id)).to.eql([1])
                }),
            ))

        it("should link a user to the current company", () =>
            forEachDataSource((dataSource) =>
                asRole(dataSource, COMPANY_ROLE, "A", async (query) => {
                    await query(
                        `INSERT INTO "${JUNCTION}" ("companyId", "userId") VALUES ('A', 3)`,
                    )
                    expect(await links(query)).to.eql(["A:1", "A:3"])
                }),
            ))

        it("should not link a user to another company", () =>
            forEachDataSource((dataSource) =>
                asRole(dataSource, COMPANY_ROLE, "A", async (query) => {
                    let error: any
                    try {
                        await query(
                            `INSERT INTO "${JUNCTION}" ("companyId", "userId") VALUES ('B', 3)`,
                        )
                    } catch (e) {
                        error = e
                    }
                    expect(error?.message).to.match(REJECTED)
                }),
            ))

        it("should not unlink the users of another company", () =>
            forEachDataSource(async (dataSource) => {
                await asRole(dataSource, COMPANY_ROLE, "A", async (query) => {
                    await query(`DELETE FROM "${JUNCTION}" WHERE "userId" = 2`)
                })
                const remaining = await dataSource.query(
                    `SELECT "userId" FROM "${JUNCTION}" ORDER BY "userId"`,
                )
                expect(remaining.map((row: any) => row.userId)).to.eql([1, 2])
            }))

        it("should unlink the users of the current company", () =>
            forEachDataSource(async (dataSource) => {
                await asRole(dataSource, COMPANY_ROLE, "A", async (query) => {
                    await query(`DELETE FROM "${JUNCTION}" WHERE "userId" = 1`)
                })
                const remaining = await dataSource.query(
                    `SELECT "userId" FROM "${JUNCTION}" ORDER BY "userId"`,
                )
                expect(remaining.map((row: any) => row.userId)).to.eql([2])
            }))

        it("should return all the links to a role that is not restricted", () =>
            forEachDataSource((dataSource) =>
                asRole(dataSource, UNRESTRICTED_ROLE, null, async (query) => {
                    expect(await links(query)).to.eql(["A:1", "B:2"])
                }),
            ))
    })
})

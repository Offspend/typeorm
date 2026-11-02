import "reflect-metadata"
import {
    createTestingConnections,
    closeTestingConnections,
    reloadTestingDatabases,
} from "../../utils/test-utils"
import {
    DataSource,
    DefaultNamingStrategy,
    EntityMetadata,
    EntityTarget,
} from "../../../src"
import { expect } from "chai"
import { Tenant } from "./entity/Tenant"
import { RowLevelSecurityPolicyMetadata } from "../../../src/metadata/RowLevelSecurityMetadata"
import { Company } from "./entity/Company"
import { CompanyForced } from "./entity/CompanyForced"
import { stringSimilarity } from "string-similarity-js"
import { RowLevelSecurityPolicyMetadataArgs } from "../../../src/metadata-args/RowLevelSecurityPolicyMetadataArgs"
import { Inherited } from "./entity/Inherited"
import { ViewBase, ViewInherited } from "./entity/ViewInherited"
function allCombinations<T>(arr: T[]): T[][] {
    if (arr.length === 0) return [[]]

    const [first, ...rest] = arr
    const combinationsWithoutFirst = allCombinations(rest)
    const combinationsWithFirst = combinationsWithoutFirst.map(
        (combination) => [first, ...combination],
    )
    return [...combinationsWithoutFirst, ...combinationsWithFirst]
}

describe("github issues > #11111 Row Level Security For Postgres", () => {
    let dataSources: DataSource[]
    before(
        async () =>
            (dataSources = await createTestingConnections({
                entities: [
                    Tenant,
                    Company,
                    CompanyForced,
                    Inherited,
                    ViewBase,
                    ViewInherited,
                ],
                // logging: true,
            })),
    )
    beforeEach(() => reloadTestingDatabases(dataSources))
    after(() => closeTestingConnections(dataSources))

    const mapAllDataSources = (
        fn: (dataSource: DataSource) => Promise<void>,
    ) => {
        return Promise.all(dataSources.map(fn))
    }

    const testSynchronize = (
        entityMetadataMutator: (entityMetadata: EntityMetadata) => void,
        assertingSql: string,
        assertingResult: (result: any[]) => void,
        target: EntityTarget<any> = Tenant,
    ): Promise<void[]> =>
        mapAllDataSources(async (dataSource) => {
            const entityMetadata = dataSource.getMetadata(target)
            entityMetadataMutator(entityMetadata)
            await dataSource.synchronize()
            const result = await dataSource.manager.query(assertingSql)
            assertingResult(result)
        })

    it("should do enable row level security via @Entity decorator", () =>
        mapAllDataSources(async (dataSource) => {
            const sql =
                "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'tenant'"

            const result = await dataSource.manager.query(sql)
            expect(result).to.be.eql([
                { relrowsecurity: true, relforcerowsecurity: false },
            ])
        }))

    it("should do enable row level security via @RowLevelSecurity decorator", () =>
        mapAllDataSources(async (dataSource) => {
            const sql =
                "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'company'"

            const result = await dataSource.manager.query(sql)
            expect(result).to.be.eql([
                { relrowsecurity: true, relforcerowsecurity: false },
            ])
        }))

    it("should do enable row level security via @RowLevelSecurity decorator on inherited class", () =>
        mapAllDataSources(async (dataSource) => {
            const sql =
                "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'inherited'"

            const result = await dataSource.manager.query(sql)
            expect(result).to.be.eql([
                { relrowsecurity: true, relforcerowsecurity: false },
            ])
        }))

    it("should do enable row level security via @RowLevelSecurity decorator with force option", () =>
        mapAllDataSources(async (dataSource) => {
            const sql =
                "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'company_forced'"

            const result = await dataSource.manager.query(sql)
            expect(result).to.be.eql([
                { relrowsecurity: true, relforcerowsecurity: true },
            ])
        }))

    it("should do enable security_invoker=true when as a default", () =>
        mapAllDataSources(async (dataSource) => {
            const sql =
                "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'view_base'"

            const result = await dataSource.manager.query(sql)
            expect(result).to.be.eql([
                { relrowsecurity: true, relforcerowsecurity: false },
            ])

            const viewSql =
                "SELECT reloptions FROM pg_class WHERE relname = 'view_inherited'"

            const viewResult = await dataSource.manager.query(viewSql)
            expect(viewResult).to.be.eql([
                { reloptions: ["security_invoker=true"] },
            ])

            const metadata = dataSource.getMetadata(ViewInherited)
            expect(metadata.tableMetadataArgs.secured).to.be.eql(true)
        }))

    it("should do disable security_invoker=false when @ViewEntity is passed with secured: false", () =>
        testSynchronize(
            (entityMetadata) => {
                entityMetadata.tableMetadataArgs.secured = false
                entityMetadata.secured = false
            },
            "SELECT reloptions FROM pg_class WHERE relname = 'view_inherited'",
            (result) => {
                expect(result).to.be.eql([{ reloptions: null }])
            },
            ViewInherited,
        ))

    const cases: [
        (
            | undefined
            | true
            | {
                  enabled: true
                  force: true
              }
        ),
        [boolean, boolean],
    ][] = [
        [true, [true, false]],
        [undefined, [false, false]],
        [
            {
                enabled: true,
                force: true,
            },
            [true, true],
        ],
    ]

    cases.forEach(([rowLevelSecurity, [enabled, force]]) => {
        it(`should correctly synchronize when table comment change ${
            rowLevelSecurity?.toString() ?? "undefined"
        }`, () =>
            testSynchronize(
                (entityMetadata) => {
                    entityMetadata.rowLevelSecurity = rowLevelSecurity
                },
                "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'tenant'",
                (result) => {
                    expect(result).to.be.eql([
                        { relrowsecurity: enabled, relforcerowsecurity: force },
                    ])
                },
            ))
    })

    it("should revert row level security changes on down migration", () =>
        mapAllDataSources(async (dataSource) => {
            const queryRunner = dataSource.createQueryRunner()
            const query =
                "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'tenant'"
            try {
                // previous tests leave the shared metadata mutated: reset the baseline
                dataSource.getMetadata(Tenant).rowLevelSecurity = true
                await dataSource.synchronize(true)
                const table = await queryRunner.getTable("tenant")
                await queryRunner.changeTableRowLevelSecurity(table!, undefined)
                expect(await queryRunner.query(query)).to.be.eql([
                    { relrowsecurity: false, relforcerowsecurity: false },
                ])

                await queryRunner.executeMemoryDownSql()
                expect(await queryRunner.query(query)).to.be.eql([
                    { relrowsecurity: true, relforcerowsecurity: false },
                ])
            } finally {
                await queryRunner.release()
            }
        }))

    it("should keep the cached table in sync across consecutive row level security changes", () =>
        mapAllDataSources(async (dataSource) => {
            const queryRunner = dataSource.createQueryRunner()
            const query =
                "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'tenant'"
            try {
                dataSource.getMetadata(Tenant).rowLevelSecurity = true
                await dataSource.synchronize(true)
                await queryRunner.getTable("tenant")

                await queryRunner.changeTableRowLevelSecurity(
                    "tenant",
                    undefined,
                )
                await queryRunner.changeTableRowLevelSecurity("tenant", true)
                expect(await queryRunner.query(query)).to.be.eql([
                    { relrowsecurity: true, relforcerowsecurity: false },
                ])
            } finally {
                await queryRunner.release()
            }
        }))

    // the forced case equals the baseline, so it produces no queries
    cases.slice(0, 2).forEach(([rowLevelSecurity]) => {
        it(`should generate reversible migration queries when row level security changes to ${
            rowLevelSecurity?.toString() ?? "undefined"
        }`, () =>
            mapAllDataSources(async (dataSource) => {
                const metadata = dataSource.getMetadata(Tenant)
                metadata.rowLevelSecurity = {
                    enabled: true,
                    force: true,
                }
                await dataSource.synchronize(true)

                metadata.rowLevelSecurity = rowLevelSecurity
                const sqlInMemory = await dataSource.driver
                    .createSchemaBuilder()
                    .log()
                expect(sqlInMemory.upQueries.length).to.be.greaterThan(0)
                expect(sqlInMemory.downQueries.length).to.be.greaterThan(0)

                // running up then down must bring the schema back to the baseline
                const queryRunner = dataSource.createQueryRunner()
                try {
                    for (const { query } of sqlInMemory.upQueries)
                        await queryRunner.query(query)
                    for (const { query } of sqlInMemory.downQueries)
                        await queryRunner.query(query)
                    metadata.rowLevelSecurity = { enabled: true, force: true }
                    const after = await dataSource.driver
                        .createSchemaBuilder()
                        .log()
                    expect(after.upQueries).to.have.length(0)
                } finally {
                    await queryRunner.release()
                }
            }))
    })

    type PartialPolicy = {
        type?: "permissive" | "restrictive"
        role?: string
        expression: string
        name?: string
    }

    const defaultPolicy: Omit<RowLevelSecurityPolicyMetadataArgs, "target"> = {
        expression: "tenant_id = current_setting('app.tenant_id', true)::uuid",
    }

    const policies: Omit<RowLevelSecurityPolicyMetadataArgs, "target">[] = [
        defaultPolicy,
        {
            ...defaultPolicy,
            type: "restrictive",
        },
        {
            ...defaultPolicy,
            type: "permissive",
        },
        {
            ...defaultPolicy,
            type: "restrictive",
            role: "test",
        },
        {
            ...defaultPolicy,
            expression: "TRUE",
        },
    ]

    const policiesCases: Omit<
        RowLevelSecurityPolicyMetadataArgs,
        "target"
    >[][] = allCombinations(policies)

    const matchPolicies = (policy: PartialPolicy[], result: any[]) => {
        const namingStrategy = new DefaultNamingStrategy()

        expect(policy.length).to.be.eql(result.length)

        policy.forEach((p) => {
            const policyName =
                p.name ??
                namingStrategy.rowLevelSecurityPolicyName(
                    "tenant",
                    p.expression,
                    p.role,
                    p.type,
                )

            const resultPolicy = result.find(
                (r) =>
                    r.schemaname === "public" &&
                    r.tablename === "tenant" &&
                    r.policyname === policyName,
            )

            expect(resultPolicy).to.not.be.undefined

            expect(resultPolicy.schemaname).to.be.eql("public")
            expect(resultPolicy.tablename).to.be.eql("tenant")
            expect(resultPolicy.policyname).to.be.eql(policyName)
            expect(resultPolicy.roles).to.be.eql(`{${p.role ?? "public"}}`)
            expect(
                stringSimilarity(resultPolicy.qual, p.expression),
            ).to.be.greaterThan(0.75)
            expect(resultPolicy.with_check).to.eql(null)
            expect(resultPolicy.permissive).to.be.eql(
                p.type === "restrictive" ? "RESTRICTIVE" : "PERMISSIVE",
            )
        })
    }

    it("should do create row level security policy", () =>
        mapAllDataSources(async (dataSource) => {
            const sql = "SELECT * FROM pg_policies WHERE tablename = 'tenant'"

            const result = await dataSource.manager.query(sql)

            matchPolicies([defaultPolicy], result)
        }))

    policiesCases.forEach((policies, item) => {
        it(`should do create row level security policy (case ${
            item + 1
        })`, async () => {
            const namingStrategy = new DefaultNamingStrategy()
            await testSynchronize(
                (entityMetadata) => {
                    //pretty print policies as an table
                    console.table(
                        policies.map((p) => ({
                            ...p,
                            target: "tenant",
                        })),
                    )

                    entityMetadata.rowLevelSecurityPolicies = policies.map(
                        (policy) =>
                            new RowLevelSecurityPolicyMetadata({
                                entityMetadata,
                                args: {
                                    ...policy,
                                    target: "tenant",
                                },
                            }).build(namingStrategy),
                    )
                },
                "SELECT * FROM pg_policies WHERE tablename = 'tenant'",
                (result) => {
                    matchPolicies(policies, result)
                },
            )
        })
    })
})

import "reflect-metadata"
import {
    createTestingConnections,
    closeTestingConnections,
    reloadTestingDatabases,
} from "../../utils/test-utils"
import { DataSource, DefaultNamingStrategy, EntityMetadata } from "../../../src"
import { expect } from "chai"
import { Tenant } from "./entity/Tenant"
import { RowLevelSecurityPolicyMetadata } from "../../../src/metadata/RowLevelSecurityMetadata"
import { Company } from "./entity/Company"
import { CompanyForced } from "./entity/CompanyForced"
import { stringSimilarity } from "string-similarity-js"
import { RowLevelSecurityPolicyMetadataArgs } from "../../../src/metadata-args/RowLevelSecurityPolicyMetadataArgs"

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
                entities: [Tenant, Company, CompanyForced],
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
    ): Promise<void[]> =>
        mapAllDataSources(async (dataSource) => {
            const entityMetadata = dataSource.getMetadata(Tenant)
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

    it("should do enable row level security via @RowLevelSecurity decorator with force option", () =>
        mapAllDataSources(async (dataSource) => {
            const sql =
                "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'company_forced'"

            const result = await dataSource.manager.query(sql)
            expect(result).to.be.eql([
                { relrowsecurity: true, relforcerowsecurity: true },
            ])
        }))

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

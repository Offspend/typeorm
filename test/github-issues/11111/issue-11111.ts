import "reflect-metadata"
import {
    createTestingConnections,
    closeTestingConnections,
    //   reloadTestingDatabases,
} from "../../utils/test-utils"
import { DataSource, DefaultNamingStrategy, EntityMetadata } from "../../../src"
import { expect } from "chai"
import { Tenant } from "./entity/Tenant"
import { stringSimilarity } from "string-similarity-js"

describe.only("github issues > #11111 Row Level Security For Postgres", () => {
    let dataSources: DataSource[]
    before(
        async () =>
            (dataSources = await createTestingConnections({
                entities: [Tenant],
                logging: true,
            })),
    )
    //  beforeEach(() => reloadTestingDatabases(dataSources))
    after(() => closeTestingConnections(dataSources))

    const mapAllDataSources = (
        fn: (dataSource: DataSource) => Promise<void>,
    ) => {
        return Promise.all(dataSources.map(fn))
    }

    const testSynchronize = (
        entityMetadataMutator: (entityMetadata: EntityMetadata) => void,
        assertingSql: string,
        assertingResult: any[],
    ): Promise<void[]> =>
        mapAllDataSources(async (dataSource) => {
            const entityMetadata = dataSource.getMetadata(Tenant)
            entityMetadataMutator(entityMetadata)
            await dataSource.synchronize()
            const result = await dataSource.manager.query(assertingSql)
            expect(result).to.be.eql(assertingResult)
        })

    it("should do enable row level security", () =>
        mapAllDataSources(async (dataSource) => {
            const sql =
                "SELECT relrowsecurity FROM pg_class WHERE relname = 'tenant'"

            const result = await dataSource.manager.query(sql)
            expect(result).to.be.eql([{ relrowsecurity: true }])
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
                [{ relrowsecurity: enabled, relforcerowsecurity: force }],
            ))
    })

    type PartialPolicy = {
        type?: "permissive" | "restrictive"
        role?: string
        expression: string
        name?: string
    }

    const defaultPolicy: PartialPolicy = {
        expression: "tenant_id = current_setting('app.tenant_id', true)::uuid",
    }

    //  const policies: PartialPolicy[] = [defaultPolicy]

    // const policiesCases: PartialPolicy[][] = {}

    const matchPolicies = (policy: PartialPolicy[], result: any[]) => {
        const namingStrategy = new DefaultNamingStrategy()

        expect(policy.length).to.be.eql(result.length)

        policy.forEach((p) => {
            const policyName =
                p.name ??
                namingStrategy.rowLevelSecurityPolicyName(
                    "tenant",
                    p.expression,
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
})

import "reflect-metadata"
import {
    createTestingConnections,
    closeTestingConnections,
    //   reloadTestingDatabases,
} from "../../utils/test-utils"
import { DataSource, EntityMetadata } from "../../../src"
import { expect } from "chai"
import { Tenant } from "./entity/Tenant"

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
})

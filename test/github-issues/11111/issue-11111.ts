import "reflect-metadata"
import {
    createTestingConnections,
    closeTestingConnections,
    reloadTestingDatabases,
} from "../../utils/test-utils"
import { DataSource } from "../../../src"
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
    beforeEach(() => reloadTestingDatabases(dataSources))
    after(() => closeTestingConnections(dataSources))

    it("should do enable row level security", () =>
        Promise.all(
            dataSources.map(async (dataSource) => {
                const sql =
                    "SELECT relrowsecurity FROM pg_class WHERE relname = 'tenant'"

                const result = await dataSource.manager.query(sql)
                expect(result).to.be.eql([{ relrowsecurity: true }])
            }),
        ))
})

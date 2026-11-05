import { DataSource } from "../../../src"
import {
    closeTestingConnections,
    createTestingConnections,
} from "../../utils/test-utils"
import { OptionalCompanyScoped } from "./entity/OptionalCompanyScoped"

/**
 * Shared setup of the OptionalCompanyScoped entity: policies restrict COMPANY_ROLE,
 * UNRESTRICTED_ROLE is only covered by the permissive TRUE policy.
 */
export const COMPANY_ROLE = "company_rw_user"
export const UNRESTRICTED_ROLE = "unrestricted_user"
export const COMPANY_TABLE = "optional_company_scoped"

const ROLES = [COMPANY_ROLE, UNRESTRICTED_ROLE]

export async function createCompanyScopedDataSources(
    entities: Function[] = [OptionalCompanyScoped],
): Promise<DataSource[]> {
    const dataSources = await createTestingConnections({
        entities,
        enabledDrivers: ["postgres"],
        schemaCreate: false,
        dropSchema: true,
    })
    for (const dataSource of dataSources) {
        for (const role of ROLES) {
            await dataSource.query(`DROP ROLE IF EXISTS ${role}`)
            await dataSource.query(`CREATE ROLE ${role}`)
        }
    }
    return dataSources
}

/**
 * Recreates the table with the rows: 1 -> company A, 2 -> public, 3 -> company B.
 */
export async function resetCompanyScopedTable(
    dataSources: DataSource[],
): Promise<void> {
    for (const dataSource of dataSources) {
        await dataSource.dropDatabase()
        await dataSource.synchronize()
        for (const role of ROLES)
            await dataSource.query(
                `GRANT SELECT, INSERT, UPDATE, DELETE ON "${COMPANY_TABLE}" TO ${role}`,
            )
        await dataSource.query(
            `INSERT INTO "${COMPANY_TABLE}" ("id", "companyId") VALUES (1, 'A'), (2, NULL), (3, 'B')`,
        )
    }
}

export async function dropCompanyScoped(
    dataSources: DataSource[],
): Promise<void> {
    for (const dataSource of dataSources) {
        await dataSource.dropDatabase()
        for (const role of ROLES)
            await dataSource.query(`DROP ROLE IF EXISTS ${role}`)
    }
    await closeTestingConnections(dataSources)
}

/**
 * Runs queries as the given role, acting for the given company
 * (null: `app.company_id` is not set).
 */
export async function asRole(
    dataSource: DataSource,
    role: string,
    company: string | null,
    fn: (query: (sql: string) => Promise<any>) => Promise<void>,
): Promise<void> {
    const queryRunner = dataSource.createQueryRunner()
    try {
        await queryRunner.query(`SET ROLE ${role}`)
        if (company !== null)
            await queryRunner.query(
                `SELECT set_config('app.company_id', '${company}', false)`,
            )
        await fn(async (sql) => {
            const result = await queryRunner.query(sql)
            // UPDATE and DELETE resolve to [rows, affectedCount]
            return Array.isArray(result) && typeof result[1] === "number"
                ? result[0]
                : result
        })
    } finally {
        await queryRunner.query(`RESET ROLE`)
        await queryRunner.query(`RESET app.company_id`)
        await queryRunner.release()
    }
}

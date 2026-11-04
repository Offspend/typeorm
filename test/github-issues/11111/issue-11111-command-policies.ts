import "reflect-metadata"
import { expect } from "chai"
import { DataSource } from "../../../src"
import {
    COMPANY_ROLE,
    COMPANY_TABLE,
    createCompanyScopedDataSources,
    dropCompanyScoped,
    resetCompanyScopedTable,
} from "./company-scoped"

describe("github issues > #11111 Row Level Security policy command > policy definition", () => {
    let dataSources: DataSource[]

    before(async () => (dataSources = await createCompanyScopedDataSources()))
    beforeEach(() => resetCompanyScopedTable(dataSources))
    after(() => dropCompanyScoped(dataSources))

    const forEachDataSource = (fn: (ds: DataSource) => Promise<void>) =>
        Promise.all(dataSources.map(fn))

    const policies = (dataSource: DataSource) =>
        dataSource.query(
            `SELECT policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE tablename = '${COMPANY_TABLE}' ORDER BY cmd, policyname`,
        )

    it("should create one restrictive policy per command", () =>
        forEachDataSource(async (dataSource) => {
            const restrictive = (await policies(dataSource)).filter(
                (p: any) => p.permissive === "RESTRICTIVE",
            )
            expect(restrictive.map((p: any) => p.cmd).sort()).to.eql([
                "DELETE",
                "INSERT",
                "SELECT",
                "UPDATE",
            ])
            for (const policy of restrictive)
                expect(policy.roles).to.equal(`{${COMPANY_ROLE}}`)
        }))

    it("should use WITH CHECK for insert and USING for the other commands", () =>
        forEachDataSource(async (dataSource) => {
            const restrictive = (await policies(dataSource)).filter(
                (p: any) => p.permissive === "RESTRICTIVE",
            )
            for (const policy of restrictive) {
                if (policy.cmd === "INSERT") {
                    // INSERT policies only have WITH CHECK
                    expect(policy.qual).to.equal(null)
                    expect(policy.with_check).to.contain("companyId")
                } else {
                    expect(policy.qual).to.contain("companyId")
                }
            }
        }))

    it("should allow public rows in the select policy only", () =>
        forEachDataSource(async (dataSource) => {
            const restrictive = (await policies(dataSource)).filter(
                (p: any) => p.permissive === "RESTRICTIVE",
            )
            for (const policy of restrictive) {
                const expression = policy.qual ?? policy.with_check
                expect(expression.includes("IS NULL")).to.equal(
                    policy.cmd === "SELECT",
                )
            }
        }))

    it("should keep the permissive policy without command as FOR ALL", () =>
        forEachDataSource(async (dataSource) => {
            const permissive = (await policies(dataSource)).filter(
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

    it("should load the command and expression of each policy", () =>
        forEachDataSource(async (dataSource) => {
            const queryRunner = dataSource.createQueryRunner()
            try {
                const table = await queryRunner.getTable(COMPANY_TABLE)
                const commands = table!.rowLevelSecurityPolicies
                    .map((p) => p.command)
                    .sort()
                expect(commands).to.eql([
                    "all",
                    "delete",
                    "insert",
                    "select",
                    "update",
                ])
                // the expression of an insert policy comes from WITH CHECK
                for (const policy of table!.rowLevelSecurityPolicies)
                    expect(policy.expression).to.be.a("string")
            } finally {
                await queryRunner.release()
            }
        }))

    it("should recreate dropped policies with their command on down migration", () =>
        forEachDataSource(async (dataSource) => {
            const before = await policies(dataSource)
            const queryRunner = dataSource.createQueryRunner()
            try {
                const table = await queryRunner.getTable(COMPANY_TABLE)
                for (const policy of table!.rowLevelSecurityPolicies.filter(
                    (p) => p.command !== "all",
                ))
                    await queryRunner.dropRowLevelSecurityPolicy(table!, policy)
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

    it("should recreate the policies when synchronizing after they were dropped", () =>
        forEachDataSource(async (dataSource) => {
            const before = await policies(dataSource)
            for (const policy of before.filter(
                (p: any) => p.permissive === "RESTRICTIVE",
            ))
                await dataSource.query(
                    `DROP POLICY "${policy.policyname}" ON "${COMPANY_TABLE}"`,
                )
            await dataSource.synchronize()
            expect(await policies(dataSource)).to.eql(before)
        }))
})

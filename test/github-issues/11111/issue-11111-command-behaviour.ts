import "reflect-metadata"
import { expect } from "chai"
import { DataSource } from "../../../src"
import {
    asRole,
    COMPANY_ROLE,
    COMPANY_TABLE,
    createCompanyScopedDataSources,
    dropCompanyScoped,
    resetCompanyScopedTable,
    UNRESTRICTED_ROLE,
} from "./company-scoped"

/**
 * Rows: 1 -> company A, 2 -> public (no company), 3 -> company B.
 * A company reads its rows and the public rows, and can only write its own rows.
 */
describe("github issues > #11111 Row Level Security policy command > behaviour", () => {
    let dataSources: DataSource[]

    before(async () => (dataSources = await createCompanyScopedDataSources()))
    beforeEach(() => resetCompanyScopedTable(dataSources))
    after(() => dropCompanyScoped(dataSources))

    const forEachDataSource = (fn: (ds: DataSource) => Promise<void>) =>
        Promise.all(dataSources.map(fn))

    const ids = (rows: any[]) => rows.map((row) => row.id)
    const REJECTED = /row-level security policy/

    const allIds = async (dataSource: DataSource) =>
        ids(
            await dataSource.query(
                `SELECT id FROM "${COMPANY_TABLE}" ORDER BY id`,
            ),
        )

    describe("select", () => {
        it("should return the rows of company A and the public rows", () =>
            forEachDataSource((dataSource) =>
                asRole(dataSource, COMPANY_ROLE, "A", async (query) => {
                    expect(
                        ids(
                            await query(
                                `SELECT id FROM "${COMPANY_TABLE}" ORDER BY id`,
                            ),
                        ),
                    ).to.eql([1, 2])
                }),
            ))

        it("should return the rows of company B and the public rows", () =>
            forEachDataSource((dataSource) =>
                asRole(dataSource, COMPANY_ROLE, "B", async (query) => {
                    expect(
                        ids(
                            await query(
                                `SELECT id FROM "${COMPANY_TABLE}" ORDER BY id`,
                            ),
                        ),
                    ).to.eql([2, 3])
                }),
            ))

        it("should only return the public rows when no company is set", () =>
            forEachDataSource((dataSource) =>
                asRole(dataSource, COMPANY_ROLE, null, async (query) => {
                    expect(
                        ids(
                            await query(
                                `SELECT id FROM "${COMPANY_TABLE}" ORDER BY id`,
                            ),
                        ),
                    ).to.eql([2])
                }),
            ))
    })

    describe("insert", () => {
        it("should accept a row of the company", () =>
            forEachDataSource(async (dataSource) => {
                await asRole(dataSource, COMPANY_ROLE, "A", async (query) => {
                    await query(
                        `INSERT INTO "${COMPANY_TABLE}" ("id", "companyId") VALUES (10, 'A')`,
                    )
                })
                expect(await allIds(dataSource)).to.eql([1, 2, 3, 10])
            }))

        it("should reject a public row", () =>
            forEachDataSource((dataSource) =>
                asRole(dataSource, COMPANY_ROLE, "A", async (query) => {
                    await expect(
                        query(
                            `INSERT INTO "${COMPANY_TABLE}" ("id", "companyId") VALUES (11, NULL)`,
                        ),
                    ).to.be.rejectedWith(REJECTED)
                }),
            ))

        it("should reject a row of another company", () =>
            forEachDataSource((dataSource) =>
                asRole(dataSource, COMPANY_ROLE, "A", async (query) => {
                    await expect(
                        query(
                            `INSERT INTO "${COMPANY_TABLE}" ("id", "companyId") VALUES (12, 'B')`,
                        ),
                    ).to.be.rejectedWith(REJECTED)
                }),
            ))

        it("should reject any row when no company is set", () =>
            forEachDataSource((dataSource) =>
                asRole(dataSource, COMPANY_ROLE, null, async (query) => {
                    for (const companyId of ["NULL", "'A'"])
                        await expect(
                            query(
                                `INSERT INTO "${COMPANY_TABLE}" ("id", "companyId") VALUES (13, ${companyId})`,
                            ),
                        ).to.be.rejectedWith(REJECTED)
                }),
            ))
    })

    describe("update", () => {
        it("should update a row of the company", () =>
            forEachDataSource((dataSource) =>
                asRole(dataSource, COMPANY_ROLE, "A", async (query) => {
                    expect(
                        ids(
                            await query(
                                `UPDATE "${COMPANY_TABLE}" SET "id" = 1 WHERE id = 1 RETURNING id`,
                            ),
                        ),
                    ).to.eql([1])
                }),
            ))

        it("should not update a public row, nor claim it", () =>
            forEachDataSource(async (dataSource) => {
                await asRole(dataSource, COMPANY_ROLE, "A", async (query) => {
                    for (const companyId of ["NULL", "'A'"])
                        expect(
                            await query(
                                `UPDATE "${COMPANY_TABLE}" SET "companyId" = ${companyId} WHERE id = 2 RETURNING id`,
                            ),
                        ).to.eql([])
                })
                const [row] = await dataSource.query(
                    `SELECT "companyId" FROM "${COMPANY_TABLE}" WHERE id = 2`,
                )
                expect(row.companyId).to.equal(null)
            }))

        it("should not update a row of another company", () =>
            forEachDataSource((dataSource) =>
                asRole(dataSource, COMPANY_ROLE, "A", async (query) => {
                    expect(
                        await query(
                            `UPDATE "${COMPANY_TABLE}" SET "companyId" = 'A' WHERE id = 3 RETURNING id`,
                        ),
                    ).to.eql([])
                }),
            ))

        it("should not move a row of the company to another company or make it public", () =>
            forEachDataSource((dataSource) =>
                asRole(dataSource, COMPANY_ROLE, "A", async (query) => {
                    for (const companyId of ["NULL", "'B'"])
                        await expect(
                            query(
                                `UPDATE "${COMPANY_TABLE}" SET "companyId" = ${companyId} WHERE id = 1`,
                            ),
                        ).to.be.rejectedWith(REJECTED)
                }),
            ))

        it("should not update anything when no company is set", () =>
            forEachDataSource((dataSource) =>
                asRole(dataSource, COMPANY_ROLE, null, async (query) => {
                    expect(
                        await query(
                            `UPDATE "${COMPANY_TABLE}" SET "id" = "id" RETURNING id`,
                        ),
                    ).to.eql([])
                }),
            ))
    })

    describe("delete", () => {
        it("should delete a row of the company", () =>
            forEachDataSource(async (dataSource) => {
                await asRole(dataSource, COMPANY_ROLE, "A", async (query) => {
                    expect(
                        ids(
                            await query(
                                `DELETE FROM "${COMPANY_TABLE}" WHERE id = 1 RETURNING id`,
                            ),
                        ),
                    ).to.eql([1])
                })
                expect(await allIds(dataSource)).to.eql([2, 3])
            }))

        it("should not delete a public row", () =>
            forEachDataSource(async (dataSource) => {
                await asRole(dataSource, COMPANY_ROLE, "A", async (query) => {
                    expect(
                        await query(
                            `DELETE FROM "${COMPANY_TABLE}" WHERE id = 2 RETURNING id`,
                        ),
                    ).to.eql([])
                })
                expect(await allIds(dataSource)).to.eql([1, 2, 3])
            }))

        it("should not delete a row of another company", () =>
            forEachDataSource(async (dataSource) => {
                await asRole(dataSource, COMPANY_ROLE, "A", async (query) => {
                    expect(
                        await query(
                            `DELETE FROM "${COMPANY_TABLE}" WHERE id = 3 RETURNING id`,
                        ),
                    ).to.eql([])
                })
                expect(await allIds(dataSource)).to.eql([1, 2, 3])
            }))

        it("should not delete anything when no company is set", () =>
            forEachDataSource(async (dataSource) => {
                await asRole(dataSource, COMPANY_ROLE, null, async (query) => {
                    expect(
                        await query(
                            `DELETE FROM "${COMPANY_TABLE}" RETURNING id`,
                        ),
                    ).to.eql([])
                })
                expect(await allIds(dataSource)).to.eql([1, 2, 3])
            }))
    })

    describe("roles", () => {
        it("should not restrict a role the restrictive policies do not target", () =>
            forEachDataSource(async (dataSource) => {
                await asRole(
                    dataSource,
                    UNRESTRICTED_ROLE,
                    null,
                    async (query) => {
                        expect(
                            ids(
                                await query(
                                    `SELECT id FROM "${COMPANY_TABLE}" ORDER BY id`,
                                ),
                            ),
                        ).to.eql([1, 2, 3])
                        expect(
                            ids(
                                await query(
                                    `DELETE FROM "${COMPANY_TABLE}" WHERE id = 2 RETURNING id`,
                                ),
                            ),
                        ).to.eql([2])
                    },
                )
                expect(await allIds(dataSource)).to.eql([1, 3])
            }))
    })
})

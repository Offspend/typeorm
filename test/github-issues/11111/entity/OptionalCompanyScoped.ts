import {
    Column,
    Entity,
    PrimaryColumn,
    RowLevelSecurityPolicy,
} from "../../../../src"

const COMPANY = `"companyId" = current_setting('app.company_id', true)`

/**
 * Rows of the current company are readable and writable, rows without company
 * ("public" rows) are readable but cannot be inserted, updated, claimed or deleted.
 */
@Entity("optional_company_scoped", { rowLevelSecurity: true })
@RowLevelSecurityPolicy({ expression: "TRUE" })
@RowLevelSecurityPolicy({
    command: "select",
    expression: `${COMPANY} OR "companyId" IS NULL`,
    type: "restrictive",
    role: "company_rw_user",
})
@RowLevelSecurityPolicy({
    command: ["insert", "update", "delete"],
    expression: COMPANY,
    type: "restrictive",
    role: "company_rw_user",
})
export class OptionalCompanyScoped {
    @PrimaryColumn()
    id: number

    @Column({ type: "varchar", nullable: true })
    companyId: string | null
}

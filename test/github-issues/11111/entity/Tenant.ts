import { Entity, PrimaryGeneratedColumn, Column } from "../../../../src"
import { RowLevelPolicy } from "../../../../src"

@Entity({
    rowLevelSecurity: true,
})
@RowLevelPolicy({
    expression: "tenant_id = current_setting('app.tenant_id')",
})
export class Tenant {
    @PrimaryGeneratedColumn()
    id: number

    @Column({ unique: true })
    tenantId: number
}

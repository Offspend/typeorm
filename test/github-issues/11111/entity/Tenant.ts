import { Entity, PrimaryGeneratedColumn, Column } from "../../../../src"
import { RowLevelSecurityPolicy } from "../../../../src"

@Entity({
    rowLevelSecurity: true,
})
@RowLevelSecurityPolicy({
    expression: "tenant_id = current_setting('app.tenant_id', true)::uuid",
})
export class Tenant {
    @PrimaryGeneratedColumn()
    id: number

    @Column({ name: "tenant_id", unique: true, type: "uuid" })
    tenantId: string
}

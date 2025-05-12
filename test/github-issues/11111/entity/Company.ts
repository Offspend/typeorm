import { Entity, PrimaryGeneratedColumn, Column } from "../../../../src"
import { RowLevelSecurity } from "../../../../src/decorator/entity/RowLevelSecurity"

@RowLevelSecurity()
@Entity()
export class Company {
    @PrimaryGeneratedColumn()
    id: number

    @Column({ name: "tenant_id", unique: true, type: "uuid" })
    tenantId: string
}

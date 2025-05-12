import { Entity, PrimaryGeneratedColumn, Column } from "../../../../src"
import { RowLevelSecurity } from "../../../../src/decorator/entity/RowLevelSecurity"

@RowLevelSecurity({ force: true })
@Entity()
export class CompanyForced {
    @PrimaryGeneratedColumn()
    id: number

    @Column({ name: "tenant_id", unique: true, type: "uuid" })
    tenantId: string
}

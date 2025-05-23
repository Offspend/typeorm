import { Entity, PrimaryGeneratedColumn, Column } from "../../../../src"
import { EnableRowLevelSecurity } from "../../../../src/decorator/entity/EnableRowLevelSecurity"

@EnableRowLevelSecurity({ force: true })
@Entity()
export class CompanyForced {
    @PrimaryGeneratedColumn()
    id: number

    @Column({ name: "tenant_id", unique: true, type: "uuid" })
    tenantId: string
}

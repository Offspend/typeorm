import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    EnableRowLevelSecurity,
} from "../../../../src"

@EnableRowLevelSecurity()
export class Base {
    @PrimaryGeneratedColumn()
    id: number

    @Column({ name: "tenant_id", unique: true, type: "uuid" })
    tenantId: string
}

@Entity()
export class Inherited extends Base {
    @Column({ name: "name" })
    name: string
}

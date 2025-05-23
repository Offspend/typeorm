import {
    PrimaryGeneratedColumn,
    Column,
    EnableRowLevelSecurity,
    ViewEntity,
    Entity,
} from "../../../../src"

@EnableRowLevelSecurity()
@Entity()
export class ViewBase {
    @PrimaryGeneratedColumn()
    id: number

    @Column({ name: "tenant_id", unique: true, type: "uuid" })
    tenantId: string
}

@ViewEntity({
    expression: (connection) =>
        connection.createQueryBuilder().select("*").from(ViewBase, "base"),
})
export class ViewInherited extends ViewBase {}

import "reflect-metadata"
import { expect } from "chai"
import {
    DataSource,
    Entity,
    EntitySchema,
    JoinTable,
    ManyToMany,
    PrimaryColumn,
} from "../../../src"
import { JoinCompany } from "./entity/JoinCompany"
import { JoinUser } from "./entity/JoinUser"

@Entity("meta_target")
class MetaTarget {
    @PrimaryColumn()
    id: number
}

@Entity("meta_owner")
class MetaOwner {
    @PrimaryColumn()
    id: number

    @ManyToMany(() => MetaTarget)
    @JoinTable({
        name: "meta_owner_targets",
        rowLevelSecurity: { enabled: true, force: true },
        rowLevelSecurityPolicies: [
            { expression: "TRUE" },
            {
                command: ["insert", "update", "delete"],
                expression: "TRUE",
                type: "restrictive",
                role: "some_role",
            },
        ],
    })
    targets: MetaTarget[]
}

@Entity("bad_target")
class BadTarget {
    @PrimaryColumn()
    id: number
}

@Entity("bad_owner")
class BadOwner {
    @PrimaryColumn()
    id: number

    @ManyToMany(() => BadTarget)
    // @ts-expect-error policies require rowLevelSecurity
    @JoinTable({
        name: "bad_owner_targets",
        rowLevelSecurityPolicies: [{ expression: "TRUE" }],
    })
    targets: BadTarget[]
}

const SchemaTarget = new EntitySchema<{ id: number }>({
    name: "SchemaTarget",
    tableName: "schema_target",
    columns: { id: { type: Number, primary: true } },
})

const SchemaOwner = new EntitySchema<{
    id: number
    targets: unknown
    composite: unknown
}>({
    name: "SchemaOwner",
    tableName: "schema_owner",
    columns: { id: { type: Number, primary: true } },
    relations: {
        targets: {
            type: "many-to-many",
            target: "SchemaTarget",
            joinTable: {
                name: "schema_owner_targets",
                rowLevelSecurity: true,
                rowLevelSecurityPolicies: [
                    { expression: "TRUE" },
                    { command: "select", expression: "TRUE", role: "r" },
                ],
            },
        },
        composite: {
            type: "many-to-many",
            target: "SchemaTarget",
            joinTable: {
                name: "schema_owner_composite",
                joinColumns: [{ name: "ownerId", referencedColumnName: "id" }],
                inverseJoinColumns: [
                    { name: "targetId", referencedColumnName: "id" },
                ],
                rowLevelSecurity: true,
                rowLevelSecurityPolicies: [{ expression: "TRUE" }],
            },
        },
    },
})

describe("github issues > #11111 Row Level Security on a join table > metadata", () => {
    const build = async (
        type: "postgres" | "sqlite",
        entities: (Function | EntitySchema<any>)[],
    ): Promise<DataSource> => {
        const dataSource = new DataSource({
            type,
            ...(type === "sqlite" ? { database: ":memory:" } : {}),
            entities,
        } as any)
        await (dataSource as any).buildMetadatas()
        return dataSource
    }

    const junction = (dataSource: DataSource, tableName: string) =>
        dataSource.entityMetadatas.find(
            (metadata) => metadata.tableName === tableName,
        )!

    it("should set row level security and the policies on the junction metadata", async () => {
        const dataSource = await build("postgres", [JoinCompany, JoinUser])
        const metadata = junction(dataSource, "join_company_users")
        expect(metadata.rowLevelSecurity).to.equal(true)
        expect(metadata.rowLevelSecurityPolicies.map((p) => p.command)).to.eql([
            undefined,
            undefined,
        ])
        for (const policy of metadata.rowLevelSecurityPolicies)
            expect(policy.name).to.match(/^RLSP_/)
    })

    it("should keep the force option", async () => {
        const dataSource = await build("postgres", [MetaOwner, MetaTarget])
        expect(
            junction(dataSource, "meta_owner_targets").rowLevelSecurity,
        ).to.eql({ enabled: true, force: true })
    })

    it("should expand a list of commands into one policy per command", async () => {
        const dataSource = await build("postgres", [MetaOwner, MetaTarget])
        const policies = junction(
            dataSource,
            "meta_owner_targets",
        ).rowLevelSecurityPolicies
        expect(policies.map((p) => p.command)).to.eql([
            undefined,
            "insert",
            "update",
            "delete",
        ])
        expect(new Set(policies.map((p) => p.name)).size).to.equal(4)
    })

    it("should give the policies the same names on every build", async () => {
        const names = async () =>
            junction(
                await build("postgres", [MetaOwner, MetaTarget]),
                "meta_owner_targets",
            ).rowLevelSecurityPolicies.map((p) => p.name)
        expect(await names()).to.eql(await names())
    })

    it("should reject policies without row level security", async () => {
        let error: any
        try {
            await build("postgres", [BadOwner, BadTarget])
        } catch (e) {
            error = e
        }
        expect(error?.message).to.match(
            /bad_owner_targets has row level security policies but row level security is not enabled/,
        )
    })

    it("should ignore the policies on a driver other than postgres", async () => {
        const dataSource = await build("sqlite", [MetaOwner, MetaTarget])
        expect(
            junction(dataSource, "meta_owner_targets").rowLevelSecurityPolicies,
        ).to.eql([])
    })

    describe("EntitySchema", () => {
        it("should set row level security and the policies on the junction metadata", async () => {
            const dataSource = await build("postgres", [
                SchemaOwner,
                SchemaTarget,
            ])
            const metadata = junction(dataSource, "schema_owner_targets")
            expect(metadata.rowLevelSecurity).to.equal(true)
            expect(
                metadata.rowLevelSecurityPolicies.map((p) => p.command),
            ).to.eql([undefined, "select"])
        })

        it("should set row level security and the policies on a junction with several columns", async () => {
            const dataSource = await build("postgres", [
                SchemaOwner,
                SchemaTarget,
            ])
            const metadata = junction(dataSource, "schema_owner_composite")
            expect(metadata.rowLevelSecurity).to.equal(true)
            expect(metadata.rowLevelSecurityPolicies).to.have.length(1)
        })
    })
})

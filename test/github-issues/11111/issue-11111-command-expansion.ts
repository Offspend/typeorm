import "reflect-metadata"
import { expect } from "chai"
import { DefaultNamingStrategy } from "../../../src"
import { RowLevelSecurityPolicyMetadata } from "../../../src/metadata/RowLevelSecurityMetadata"
import { RowLevelSecurityPolicyMetadataArgs } from "../../../src/metadata-args/RowLevelSecurityPolicyMetadataArgs"
import { OptionalCompanyScoped } from "./entity/OptionalCompanyScoped"

describe("github issues > #11111 Row Level Security policy command > expansion", () => {
    const args = (
        command: any,
        name?: string,
    ): RowLevelSecurityPolicyMetadataArgs => ({
        target: OptionalCompanyScoped,
        expression: "TRUE",
        command,
        name,
    })

    const expand = (command: any, name?: string) =>
        RowLevelSecurityPolicyMetadata.expandArgs(args(command, name), "Entity")

    describe("expandArgs", () => {
        it("should keep a policy without command or with a single command as is", () => {
            for (const command of [undefined, "all", "select", "insert"]) {
                const expanded = expand(command, "my_policy")
                expect(expanded).to.have.length(1)
                expect(expanded[0].command).to.equal(command)
                expect(expanded[0].name).to.equal("my_policy")
            }
        })

        it("should expand a list of commands into one policy per command", () => {
            const expanded = expand(["insert", "update", "delete"])
            expect(expanded.map((e) => e.command)).to.eql([
                "insert",
                "update",
                "delete",
            ])
        })

        it("should not invent a name when none is given", () => {
            // the names are generated later from the expression, role, type and command
            expect(
                expand(["insert", "update", "delete"]).map((e) => e.name),
            ).to.eql([undefined, undefined, undefined])
        })

        it("should keep the other properties of each expanded policy", () => {
            const expanded = RowLevelSecurityPolicyMetadata.expandArgs(
                {
                    ...args(["insert", "update"]),
                    role: "some_role",
                    type: "restrictive",
                    expression: "id > 0",
                },
                "Entity",
            )
            for (const policy of expanded) {
                expect(policy.role).to.equal("some_role")
                expect(policy.type).to.equal("restrictive")
                expect(policy.expression).to.equal("id > 0")
                expect(policy.target).to.equal(OptionalCompanyScoped)
            }
        })

        it("should suffix the given name with the command when expanding several commands", () => {
            expect(
                expand(["insert", "update"], "company_write").map(
                    (e) => e.name,
                ),
            ).to.eql(["company_write_insert", "company_write_update"])
        })

        it("should keep the given name for a list with a single command", () => {
            expect(
                expand(["insert"], "company_write").map((e) => e.name),
            ).to.eql(["company_write"])
        })
    })

    describe("validation", () => {
        it("should reject an unknown single command", () => {
            expect(() => expand("read")).to.throw(/unknown command "read"/)
        })

        it("should reject an empty list", () => {
            expect(() => expand([])).to.throw(/empty list/)
        })

        it("should reject all combined with other commands", () => {
            expect(() => expand(["all", "select"])).to.throw(
                /invalid command "all"/,
            )
        })

        it("should reject an unknown command in a list", () => {
            expect(() => expand(["select", "read"])).to.throw(
                /invalid command "read"/,
            )
        })

        it("should reject duplicated commands", () => {
            expect(() => expand(["insert", "insert"])).to.throw(
                /"insert" more than once/,
            )
        })

        it("should name the entity in the error", () => {
            expect(() =>
                RowLevelSecurityPolicyMetadata.expandArgs(
                    args("read"),
                    "MyEntity",
                ),
            ).to.throw(/entity MyEntity/)
        })

        it("should reject expanded names longer than the PostgreSQL identifier limit", () => {
            // 57 bytes: fine alone, 64 once "_insert" is appended
            const name = "a".repeat(57)
            expect(() => expand(["insert", "update"], name)).to.throw(
                /longer than 63 bytes/,
            )
            expect(expand("insert", name)).to.have.length(1)
        })

        it("should count the name length in bytes", () => {
            // 30 characters but 60 bytes
            expect(() => expand(["insert", "update"], "é".repeat(30))).to.throw(
                /longer than 63 bytes/,
            )
        })
    })

    describe("naming", () => {
        const naming = new DefaultNamingStrategy()
        const name = (expression: string, command?: any) =>
            naming.rowLevelSecurityPolicyName(
                "tenant",
                expression,
                "role",
                "restrictive",
                command,
            )

        it("should not change the name of policies without command", () => {
            const legacy = naming.rowLevelSecurityPolicyName(
                "tenant",
                "TRUE",
                "role",
                "restrictive",
            )
            expect(name("TRUE", "all")).to.equal(legacy)
            expect(name("TRUE", undefined)).to.equal(legacy)
        })

        it("should give a different name to each command", () => {
            const names = [
                undefined,
                "select",
                "insert",
                "update",
                "delete",
            ].map((command) => name("TRUE", command))
            expect(new Set(names).size).to.equal(5)
        })

        it("should not collide a command-specific name with an all policy", () => {
            expect(name("select_enabled", "all")).to.not.equal(
                name("enabled", "select"),
            )
        })
    })
})

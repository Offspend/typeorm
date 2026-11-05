import { DriverUtils } from "../../src/driver/DriverUtils"
import { Driver } from "../../src/driver/Driver"
import * as StringUtils from "../../src/util/StringUtils"
import { hash } from "../../src/util/StringUtils"
import { expect } from "chai"
import sinon from "sinon"

describe(`driver-utils`, () => {
    describe("buildAlias", () => {
        const longAlias = [
            "versionedEntityVariableValue",
            "entityVariable",
            "someVeryLongColumnName",
        ]
        const joinedLongAlias = longAlias.join("_")

        let hashSpy: sinon.SinonSpy

        beforeEach(() => {
            hashSpy = sinon.spy(StringUtils, "hash")
        })

        afterEach(() => {
            hashSpy.restore()
        })

        // The hashed alias cache is shared across tests, so each test that
        // counts hash calls uses an alias no other test has built.
        function buildUniqueAlias(
            maxAliasLength: number,
            uniquePart: string,
        ): string {
            return DriverUtils.buildAlias(
                { maxAliasLength } as Driver,
                undefined,
                ...longAlias,
                uniquePart,
            )
        }

        function hashCallsFor(uniquePart: string, length: number): number {
            return hashSpy
                .getCalls()
                .filter(
                    (call) =>
                        call.args[0] === [...longAlias, uniquePart].join("_") &&
                        call.args[1].length === length,
                ).length
        }

        it("returns the same hash for a long alias on repeated calls", () => {
            const driver = { maxAliasLength: 63 } as Driver
            const expected = hash(joinedLongAlias, { length: 63 })

            for (let i = 0; i < 3; i++) {
                expect(
                    DriverUtils.buildAlias(driver, undefined, ...longAlias),
                ).to.equal(expected)
            }
        })

        it("hashes a repeated alias and length only once", () => {
            for (let i = 0; i < 3; i++) {
                buildUniqueAlias(63, "repeated")
            }

            expect(hashCallsFor("repeated", 63)).to.equal(1)
        })

        it("hashes the same alias again for a different length", () => {
            const postgresAlias = buildUniqueAlias(63, "length")
            const shortAlias = buildUniqueAlias(20, "length")

            expect(hashCallsFor("length", 63)).to.equal(1)
            expect(hashCallsFor("length", 20)).to.equal(1)
            expect(postgresAlias).to.equal(
                hash([...longAlias, "length"].join("_"), { length: 63 }),
            )
            expect(shortAlias).to.equal(
                hash([...longAlias, "length"].join("_"), { length: 20 }),
            )
            expect(shortAlias).to.have.length(20)
        })

        it("clears the cache once it holds 10,000 entries", () => {
            buildUniqueAlias(63, "evicted")
            buildUniqueAlias(63, "evicted")
            expect(hashCallsFor("evicted", 63)).to.equal(1)

            for (let i = 0; i < 10000; i++) {
                buildUniqueAlias(63, `filler${i}`)
            }
            buildUniqueAlias(63, "evicted")

            expect(hashCallsFor("evicted", 63)).to.equal(2)
        })

        it("leaves an alias within the limit unchanged", () => {
            expect(
                DriverUtils.buildAlias(
                    { maxAliasLength: 63 } as Driver,
                    undefined,
                    "user",
                    "id",
                ),
            ).to.equal("user_id")
            expect(hashSpy.called).to.equal(false)
        })
    })
})

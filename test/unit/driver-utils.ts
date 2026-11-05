import { DriverUtils } from "../../src/driver/DriverUtils"
import { Driver } from "../../src/driver/Driver"
import { hash } from "../../src/util/StringUtils"
import { expect } from "chai"

describe(`driver-utils`, () => {
    describe("buildAlias", () => {
        const longAlias = [
            "versionedEntityVariableValue",
            "entityVariable",
            "someVeryLongColumnName",
        ]
        const joinedLongAlias = longAlias.join("_")

        it("returns the same hash for a long alias on repeated calls", () => {
            const driver = { maxAliasLength: 63 } as Driver
            const expected = hash(joinedLongAlias, { length: 63 })

            for (let i = 0; i < 3; i++) {
                expect(
                    DriverUtils.buildAlias(driver, undefined, ...longAlias),
                ).to.equal(expected)
            }
        })

        it("returns a distinct hash for each max alias length", () => {
            const postgresAlias = DriverUtils.buildAlias(
                { maxAliasLength: 63 } as Driver,
                undefined,
                ...longAlias,
            )
            const shortAlias = DriverUtils.buildAlias(
                { maxAliasLength: 20 } as Driver,
                undefined,
                ...longAlias,
            )

            expect(postgresAlias).to.equal(
                hash(joinedLongAlias, { length: 63 }),
            )
            expect(shortAlias).to.equal(hash(joinedLongAlias, { length: 20 }))
            expect(shortAlias).to.have.length(20)
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
        })
    })
})

import { TableMetadataArgs } from "../../metadata-args/TableMetadataArgs"
import { getMetadataArgsStorage } from "../../globals"

/*
 * Creates a database check.
 * Can be used on entity property or on entity.
 * Can create checks with composite columns when used on entity.
 */
export function RowLevelSecurity(options?: {
    force: true
}): ClassDecorator & PropertyDecorator {
    return function (
        clsOrObject: Function | Object,
        propertyName?: string | symbol,
    ) {
        const target = propertyName
            ? clsOrObject.constructor
            : (clsOrObject as Function)

        const table = getMetadataArgsStorage().tables.find(
            (table: TableMetadataArgs) => table.target === target,
        )

        if (!table) {
            throw new Error("Table not found")
        }

        table.rowLevelSecurity = options?.force
            ? { enabled: true, force: true }
            : true
    }
}

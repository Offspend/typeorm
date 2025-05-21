import { TableMetadataArgs } from "../../metadata-args/TableMetadataArgs"
import { getMetadataArgsStorage } from "../../globals"

/*
 * Creates a database check.
 * Can be used on entity property or on entity.
 * Can create checks with composite columns when used on entity.
 */

export type RowLevelSecurityOptions =
    | true
    | {
          enabled: true
          force: true
      }

export function EnableRowLevelSecurity(options?: {
    force: true
}): ClassDecorator & PropertyDecorator {
    return function (
        clsOrObject: Function | Object,
        propertyName?: string | symbol,
    ) {
        const target = propertyName
            ? clsOrObject.constructor
            : (clsOrObject as Function)

        const rowLevelSecurityOptions: RowLevelSecurityOptions = options?.force
            ? { enabled: true, force: true }
            : true

        const table = getMetadataArgsStorage().tables.find(
            (table: TableMetadataArgs) => table.target === target,
        )

        if (!table) {
            const targetWithRowLevelSecurityOptions =
                target as typeof target & {
                    _rowLevelSecurityOptions: RowLevelSecurityOptions
                }
            targetWithRowLevelSecurityOptions._rowLevelSecurityOptions =
                rowLevelSecurityOptions
        } else table.rowLevelSecurity = rowLevelSecurityOptions
    }
}

import { getMetadataArgsStorage } from "../globals"
import { RowLevelSecurityPolicyMetadataArgs } from "../metadata-args/RowLevelSecurityPolicyMetadataArgs"

/*
 * Creates a database check.
 * Can be used on entity property or on entity.
 * Can create checks with composite columns when used on entity.
 */
export function RowLevelPolicy({
    role,
    expression,
    type,
    name,
}: Omit<RowLevelSecurityPolicyMetadataArgs, "target">): ClassDecorator &
    PropertyDecorator {
    return function (
        clsOrObject: Function | Object,
        propertyName?: string | symbol,
    ) {
        getMetadataArgsStorage().rowLevelSecurityPolicies.push({
            target: propertyName
                ? clsOrObject.constructor
                : (clsOrObject as Function),
            name: name,
            expression: expression,
            type,
            role,
        })
    }
}

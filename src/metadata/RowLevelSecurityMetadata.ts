import { EntityMetadata } from "./EntityMetadata"
import { NamingStrategyInterface } from "../naming-strategy/NamingStrategyInterface"
import {
    RowLevelSecurityPolicyCommand,
    RowLevelSecurityPolicyMetadataArgs,
} from "../metadata-args/RowLevelSecurityPolicyMetadataArgs"
import { TypeORMError } from "../error"

const ROW_LEVEL_SECURITY_COMMANDS: RowLevelSecurityPolicyCommand[] = [
    "select",
    "insert",
    "update",
    "delete",
]

/**
 * RowLevelSecurity metadata contains all information about table's row level security policies.
 */
export class RowLevelSecurityPolicyMetadata {
    // ---------------------------------------------------------------------
    // Public Properties
    // ---------------------------------------------------------------------

    /**
     * Entity metadata of the class to which this row level security policy is applied.
     */
    entityMetadata: EntityMetadata

    /**
     * Target class to which metadata is applied.
     */
    target?: Function | string

    /**
     * Type of the row level security policy.
     */
    type?: "permissive" | "restrictive"

    /**
     * Command this row level security policy applies to (by default "all").
     */
    command?: "all" | RowLevelSecurityPolicyCommand

    /**
     * User to which this row level security policy is applied.
     */
    role?: string

    /**
     * Check expression.
     */
    expression: string

    /**
     * User specified check constraint name.
     */
    givenName?: string

    /**
     * Final check constraint name.
     * If check constraint name was given by a user then it stores normalized (by naming strategy) givenName.
     * If check constraint name was not given then its generated.
     */
    name: string

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(options: {
        entityMetadata: EntityMetadata
        args?: RowLevelSecurityPolicyMetadataArgs
    }) {
        this.entityMetadata = options.entityMetadata

        if (options.args) {
            this.target = options.args.target
            this.type = options.args.type
            this.expression = options.args.expression
            this.role = options.args.role
            this.givenName = options.args.name
            // lists are expanded by `expandArgs`: only a single command reaches the metadata
            this.command = options.args.command as
                | "all"
                | RowLevelSecurityPolicyCommand
                | undefined
        }
    }

    // ---------------------------------------------------------------------
    // Static Methods
    // ---------------------------------------------------------------------

    /**
     * Expands a policy declared for several commands into one policy per command,
     * since PostgreSQL only accepts a single command per policy.
     * Validates the declared command(s) for callers that bypass the types.
     */
    static expandArgs(
        args: RowLevelSecurityPolicyMetadataArgs,
        entityName: string,
    ): RowLevelSecurityPolicyMetadataArgs[] {
        const { command } = args
        if (!Array.isArray(command)) {
            if (
                command !== undefined &&
                command !== "all" &&
                !ROW_LEVEL_SECURITY_COMMANDS.includes(command as any)
            )
                throw new TypeORMError(
                    `Row level security policy on entity ${entityName} has an unknown command "${command}". ` +
                        `Use "all" or one of: ${ROW_LEVEL_SECURITY_COMMANDS.join(
                            ", ",
                        )}.`,
                )
            return [args]
        }

        const commands = command as RowLevelSecurityPolicyCommand[]
        if (commands.length === 0)
            throw new TypeORMError(
                `Row level security policy on entity ${entityName} has an empty list of commands.`,
            )
        for (const item of commands) {
            if (!ROW_LEVEL_SECURITY_COMMANDS.includes(item))
                throw new TypeORMError(
                    `Row level security policy on entity ${entityName} has an invalid command "${item}" in its list. ` +
                        `Use one of: ${ROW_LEVEL_SECURITY_COMMANDS.join(
                            ", ",
                        )} ("all" cannot be combined with other commands).`,
                )
        }
        const duplicate = commands.find(
            (item, index) => commands.indexOf(item) !== index,
        )
        if (duplicate)
            throw new TypeORMError(
                `Row level security policy on entity ${entityName} lists the command "${duplicate}" more than once.`,
            )

        return commands.map((item) => ({
            ...args,
            command: item,
            name:
                args.name && commands.length > 1
                    ? `${args.name}_${item}`
                    : args.name,
        }))
    }

    // ---------------------------------------------------------------------
    // Public Build Methods
    // ---------------------------------------------------------------------

    /**
     * Builds some depend check constraint properties.
     * Must be called after all entity metadata's properties map, columns and relations are built.
     */
    build(namingStrategy: NamingStrategyInterface): this {
        this.name = this.givenName
            ? this.givenName
            : namingStrategy.rowLevelSecurityPolicyName(
                  this.entityMetadata.tableName,
                  this.expression,
                  this.role,
                  this.type,
                  this.command,
              )
        return this
    }
}

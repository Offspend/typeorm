import { EntityMetadata } from "./EntityMetadata"
import { NamingStrategyInterface } from "../naming-strategy/NamingStrategyInterface"
import {
    RowLevelSecurityPolicyCommand,
    RowLevelSecurityPolicyMetadataArgs,
} from "../metadata-args/RowLevelSecurityPolicyMetadataArgs"
import { TypeORMError } from "../error"

const POSTGRES_MAX_IDENTIFIER_BYTES = 63

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
        if (!Array.isArray(args.command)) {
            assertKnownCommand(args.command, entityName)
            return [args]
        }

        const commands = args.command as RowLevelSecurityPolicyCommand[]
        assertNonEmptyCommandList(commands, entityName)
        assertOnlyCommandsInList(commands, entityName)
        assertNoDuplicateCommands(commands, entityName)

        return commands.map((command) => {
            const name = appendCommandToName(args.name, command, commands)
            assertNameFitsPostgresIdentifier(name, entityName)
            return { ...args, command, name }
        })
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

/**
 * A single command must be "all" (or omitted) or one of the commands.
 */
function assertKnownCommand(command: unknown, entityName: string): void {
    if (
        command === undefined ||
        command === "all" ||
        ROW_LEVEL_SECURITY_COMMANDS.includes(command as any)
    )
        return

    throw new TypeORMError(
        `Row level security policy on entity ${entityName} has an unknown command "${command}". ` +
            `Use "all" or one of: ${ROW_LEVEL_SECURITY_COMMANDS.join(", ")}.`,
    )
}

/**
 * An empty list would declare a policy that applies to nothing.
 */
function assertNonEmptyCommandList(
    commands: unknown[],
    entityName: string,
): void {
    if (commands.length > 0) return

    throw new TypeORMError(
        `Row level security policy on entity ${entityName} has an empty list of commands.`,
    )
}

/**
 * A list only accepts the commands: "all" already covers them, so it cannot be combined.
 */
function assertOnlyCommandsInList(
    commands: unknown[],
    entityName: string,
): void {
    const invalid = commands.find(
        (command) => !ROW_LEVEL_SECURITY_COMMANDS.includes(command as any),
    )
    if (invalid === undefined) return

    throw new TypeORMError(
        `Row level security policy on entity ${entityName} has an invalid command "${invalid}" in its list. ` +
            `Use one of: ${ROW_LEVEL_SECURITY_COMMANDS.join(
                ", ",
            )} ("all" cannot be combined with other commands).`,
    )
}

/**
 * The same command twice would create two policies with the same name.
 */
function assertNoDuplicateCommands(
    commands: RowLevelSecurityPolicyCommand[],
    entityName: string,
): void {
    const duplicate = commands.find(
        (command, index) => commands.indexOf(command) !== index,
    )
    if (duplicate === undefined) return

    throw new TypeORMError(
        `Row level security policy on entity ${entityName} lists the command "${duplicate}" more than once.`,
    )
}

/**
 * An explicit name is suffixed with the command when it is expanded into several policies,
 * so that each policy gets a distinct name.
 */
function appendCommandToName(
    name: string | undefined,
    command: RowLevelSecurityPolicyCommand,
    commands: RowLevelSecurityPolicyCommand[],
): string | undefined {
    return name && commands.length > 1 ? `${name}_${command}` : name
}

/**
 * PostgreSQL truncates longer identifiers, which would make the expanded names collide.
 */
function assertNameFitsPostgresIdentifier(
    name: string | undefined,
    entityName: string,
): void {
    if (!name || Buffer.byteLength(name) <= POSTGRES_MAX_IDENTIFIER_BYTES)
        return

    throw new TypeORMError(
        `Row level security policy name "${name}" on entity ${entityName} is longer than ` +
            `${POSTGRES_MAX_IDENTIFIER_BYTES} bytes once the command is appended. Use a shorter name.`,
    )
}

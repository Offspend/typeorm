/**
 * SQL command a single row level security policy applies to.
 */
export type RowLevelSecurityPolicyCommand =
    | "select"
    | "insert"
    | "update"
    | "delete"

/**
 * Command(s) a row level security policy is declared for.
 * A list is expanded into one database policy per command, since PostgreSQL
 * only accepts a single command per policy.
 */
export type RowLevelSecurityPolicyCommands =
    | "all"
    | RowLevelSecurityPolicyCommand
    | readonly [
          RowLevelSecurityPolicyCommand,
          ...RowLevelSecurityPolicyCommand[],
      ]

/**
 * Arguments for RowLevelSecurityPolicy class.
 */
export interface RowLevelSecurityPolicyMetadataArgs {
    /**
     * Class to which the policy is applied is applied.
     */
    target: Function | string

    /**
     * Role to which the policy is applied (by default it's applied to public role)
     */
    role?: string

    /**
     * policy expression.
     */
    expression: string

    /**
     * Type of the row level security policy.
     */
    type?: "permissive" | "restrictive"

    /**
     * Command(s) the policy applies to (by default "all").
     * `expression` is used as USING, except for "insert" where it is used as WITH CHECK.
     */
    command?: RowLevelSecurityPolicyCommands

    /**
     * User specified name.
     * When several commands are given, the command is appended to it (`<name>_<command>`).
     */
    name?: string
}

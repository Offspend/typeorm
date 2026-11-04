import { RowLevelSecurityPolicyCommand } from "../../metadata-args/RowLevelSecurityPolicyMetadataArgs"

/**
 * Database's table check constraint options.
 */
export interface TableRowLevelSecurityOptions {
    // -------------------------------------------------------------------------
    // Public Properties
    // -------------------------------------------------------------------------

    /**
     * Constraint name.
     */
    name?: string

    /**
     * Row level security policy expression.
     */
    expression: string

    /**
     * Type of the row level security policy.
     */
    type?: "permissive" | "restrictive"

    /**
     * Command the row level security policy applies to (by default "all").
     */
    command?: "all" | RowLevelSecurityPolicyCommand

    /**
     * Role to which this row level security policy is applied.
     */
    role?: string
}

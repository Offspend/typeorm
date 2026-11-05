import { RowLevelSecurityOptions } from "../entity/EnableRowLevelSecurity"
import { RowLevelSecurityPolicyMetadataArgs } from "../../metadata-args/RowLevelSecurityPolicyMetadataArgs"

/**
 * Row level security options of a join table.
 * Policies can only be given when row level security is enabled, otherwise they would have no effect.
 */
export type JoinTableRowLevelSecurityOptions =
    | {
          rowLevelSecurity?: undefined
          rowLevelSecurityPolicies?: never
      }
    | {
          /**
           * Enables row level security on the join table. Supported only by postgres.
           */
          rowLevelSecurity: RowLevelSecurityOptions

          /**
           * Row level security policies of the join table, same options as @RowLevelSecurityPolicy.
           */
          rowLevelSecurityPolicies?: Omit<
              RowLevelSecurityPolicyMetadataArgs,
              "target"
          >[]
      }

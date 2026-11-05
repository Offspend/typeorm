import { Entity, JoinTable, ManyToMany, PrimaryColumn } from "../../../../src"
import { JoinUser } from "./JoinUser"

/**
 * The generated junction table has a "companyId" column and is restricted like any company scoped table.
 */
@Entity("join_company")
export class JoinCompany {
    @PrimaryColumn()
    id: string

    @ManyToMany(() => JoinUser)
    @JoinTable({
        name: "join_company_users",
        joinColumn: { name: "companyId", referencedColumnName: "id" },
        inverseJoinColumn: { name: "userId", referencedColumnName: "id" },
        rowLevelSecurity: true,
        rowLevelSecurityPolicies: [
            { expression: "TRUE" },
            {
                expression: `"companyId" = current_setting('app.company_id', true)`,
                type: "restrictive",
                role: "company_rw_user",
            },
        ],
    })
    users: JoinUser[]
}

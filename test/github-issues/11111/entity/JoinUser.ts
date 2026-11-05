import { Entity, PrimaryColumn } from "../../../../src"

@Entity("join_user")
export class JoinUser {
    @PrimaryColumn()
    id: number
}

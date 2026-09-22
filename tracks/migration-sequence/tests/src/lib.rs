#[cfg(test)]
mod tests {
    use datazen_driver_api::{
        validate_sequence_definition_with_identity, MigrationOperation, MigrationRenderer,
        MigrationSequence,
    };
    use datazen_driver_postgres::PostgresMigrationRenderer;

    #[test]
    fn test_tester_sequence_validator_accepts_quote_ident_escaped_names() {
        let result = validate_sequence_definition_with_identity(
            r#"CREATE SEQUENCE "sales""team"."order""id" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;"#,
            Some("sales\"team"),
            "order\"id",
        );
        assert!(result.is_ok(), "valid quote_ident output was rejected: {result:?}");
    }

    #[test]
    fn test_tester_sequence_validator_rejects_case_mismatch_in_quoted_identity() {
        let result = validate_sequence_definition_with_identity(
            r#"CREATE SEQUENCE "public"."orders_id_seq" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;"#,
            Some("Public"),
            "Orders_Id_Seq",
        );
        assert!(result.is_err(), "quoted PostgreSQL identity is case-sensitive");
    }

    #[test]
    fn test_tester_sequence_validator_accepts_comment_like_quote_ident_name() {
        let result = validate_sequence_definition_with_identity(
            r#"CREATE SEQUENCE "public"."a--b" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;"#,
            Some("public"),
            "a--b",
        );
        assert!(result.is_ok(), "quote_ident may legally contain comment markers: {result:?}");
    }

    #[test]
    fn test_tester_sequence_replace_does_not_claim_counter_state_rollback() {
        let sequence = |increment: i64| MigrationSequence {
            schema: Some("public".into()),
            name: "orders_id_seq".into(),
            definition: format!(
                "CREATE SEQUENCE \"public\".\"orders_id_seq\" AS bigint INCREMENT BY {increment} MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;"
            ),
        };
        let statement = PostgresMigrationRenderer
            .render(&MigrationOperation::ReplaceSequence {
                current: sequence(1),
                desired: sequence(10),
            })
            .expect("valid sequence replacement should render");
        assert!(
            statement.rollback_sql.is_none(),
            "replace resets last_value and cannot provide a complete rollback"
        );
    }
}

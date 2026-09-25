use super::{column_index, value_as_ddl_text};
use crate::types::{DriverError, QueryResult};
use sqlparser::ast::GranteeName;

pub(super) fn required_view_metadata_field(
    result: &QueryResult,
    name: &str,
) -> Result<String, DriverError> {
    let index = column_index(&result.columns, &[name]).ok_or_else(|| {
        DriverError::QueryFailed(format!("MySQL view metadata missing `{name}` column"))
    })?;
    result
        .rows
        .first()
        .and_then(|row| value_as_ddl_text(row.get(index).and_then(Option::as_ref)))
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            DriverError::QueryFailed(format!("MySQL view metadata `{name}` is unavailable"))
        })
}

pub(super) fn missing_show_view_metadata(field: &str) -> DriverError {
    DriverError::QueryFailed(format!(
        "MySQL SHOW CREATE VIEW omitted `{field}` metadata; refusing an incomplete view snapshot"
    ))
}

pub(super) fn mysql_view_definer_identity(definer: &GranteeName) -> Result<String, DriverError> {
    match definer {
        GranteeName::UserHost { user, host } => Ok(format!("{}@{}", user.value, host.value)),
        GranteeName::ObjectName(_) => Err(DriverError::QueryFailed(
            "MySQL SHOW CREATE VIEW returned an unsupported DEFINER identity".into(),
        )),
    }
}

pub(super) fn metadata_value_matches(
    show_create: &str,
    catalog: &str,
    case_insensitive: bool,
) -> bool {
    let show_create = show_create.trim();
    let catalog = catalog.trim();
    if case_insensitive {
        show_create.eq_ignore_ascii_case(catalog)
    } else {
        show_create == catalog
    }
}

/// Read CHECK OPTION from SHOW CREATE VIEW's executable comment suffix.
/// MySQL emits this clause in a versioned comment on versions that need it.
/// Other comment/literal contents are ignored so a string mentioning the
/// phrase cannot be mistaken for view creation metadata.
pub(super) fn mysql_show_create_view_check_option(sql: &str) -> Result<String, DriverError> {
    let tokens = mysql_view_metadata_tokens(sql);
    let patterns: &[(&[&str], &str)] = &[
        (&["WITH", "CASCADED", "CHECK", "OPTION"], "CASCADED"),
        (&["WITH", "LOCAL", "CHECK", "OPTION"], "LOCAL"),
        (&["WITH", "CHECK", "OPTION"], "CASCADED"),
    ];
    let mut found: Option<&str> = None;
    for (pattern, value) in patterns {
        let starts = tokens
            .windows(pattern.len())
            .enumerate()
            .filter_map(|(index, window)| (window == *pattern).then_some(index))
            .collect::<Vec<_>>();
        for start in starts {
            if start + pattern.len() != tokens.len() {
                return Err(DriverError::QueryFailed(
                    "MySQL SHOW CREATE VIEW contains an unrecognized CHECK OPTION placement".into(),
                ));
            }
            if found.is_some_and(|previous| previous != *value) {
                return Err(DriverError::QueryFailed(
                    "MySQL SHOW CREATE VIEW contains conflicting CHECK OPTION metadata".into(),
                ));
            }
            found = Some(value);
        }
    }
    Ok(found.unwrap_or("NONE").into())
}

fn mysql_view_metadata_tokens(sql: &str) -> Vec<String> {
    let bytes = sql.as_bytes();
    let mut tokens = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if let Some(quote) = bytes
            .get(index)
            .copied()
            .filter(|byte| matches!(byte, b'\'' | b'"' | b'`'))
        {
            index += 1;
            while index < bytes.len() {
                if bytes[index] == b'\\' {
                    index = (index + 2).min(bytes.len());
                    continue;
                }
                if bytes[index] == quote {
                    if bytes.get(index + 1) == Some(&quote) {
                        index += 2;
                        continue;
                    }
                    index += 1;
                    break;
                }
                index += 1;
            }
            continue;
        }
        if bytes[index] == b'#'
            || (bytes[index] == b'-'
                && bytes.get(index + 1) == Some(&b'-')
                && bytes
                    .get(index + 2)
                    .is_some_and(|byte| byte.is_ascii_whitespace()))
        {
            while index < bytes.len() && bytes[index] != b'\n' {
                index += 1;
            }
            continue;
        }
        if bytes[index..].starts_with(b"/*!") {
            index += 3;
            while bytes.get(index).is_some_and(u8::is_ascii_digit) {
                index += 1;
            }
            continue;
        }
        if bytes[index..].starts_with(b"/*") {
            index += 2;
            while index + 1 < bytes.len() && !bytes[index..].starts_with(b"*/") {
                index += 1;
            }
            index = (index + 2).min(bytes.len());
            continue;
        }
        if bytes[index].is_ascii_alphabetic() || bytes[index] == b'_' {
            let start = index;
            index += 1;
            while index < bytes.len()
                && (bytes[index].is_ascii_alphanumeric() || bytes[index] == b'_')
            {
                index += 1;
            }
            tokens.push(sql[start..index].to_ascii_uppercase());
            continue;
        }
        index += 1;
    }
    tokens
}

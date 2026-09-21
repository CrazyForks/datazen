//! Schema diff planning and deploy (source = desired state → target).

pub mod compare;
pub mod dependencies;
pub mod deploy;
pub mod ir;
pub mod objects;
pub mod operations;
pub mod plan;
pub mod profile;
pub mod types;

pub use compare::diff_table_schemas;
pub use deploy::{execute_schema_diff_deploy, DeployOptions};
pub use plan::{
    build_column_plan, build_schema_diff_plan, build_schema_diff_plan_with_target_only, PlanOptions,
};
pub use profile::SchemaDiffProfile;
pub use types::*;

pub mod reviewed;

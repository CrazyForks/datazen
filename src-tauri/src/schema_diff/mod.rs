//! Schema diff planning and deploy (source = desired state → target).

pub mod compare;
pub mod dependencies;
pub mod dependency_graph;
pub mod deploy;
pub mod ir;
pub mod objects;
mod operation_dependencies;
mod operation_dependency_references;
pub mod operations;
pub mod plan;
pub mod profile;
pub mod reviewed;
pub mod types;

pub use compare::diff_table_schemas;
pub use deploy::{execute_schema_diff_deploy, execute_schema_diff_deploy_at, DeployOptions};
pub use plan::{build_column_plan, build_schema_diff_plan, PlanOptions};
pub use profile::SchemaDiffProfile;
pub use types::*;

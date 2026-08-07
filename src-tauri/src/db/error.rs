use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("database error: {0}")]
    Database(#[from] sea_orm::DbErr),
    #[error("migration error: {0}")]
    Migration(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("validation error: {0}")]
    Validation(String),
    /// An operation was attempted on a record whose current state does not
    /// allow it (e.g. closing a release that is already closed). Carries a
    /// human-readable reason.
    #[error("invalid state transition: {0}")]
    InvalidStateTransition(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

impl Serialize for DbError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

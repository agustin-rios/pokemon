//! Configuración global de la app: prefijo `/api`, CORS, ruta no encontrada y
//! errores con el cuerpo de Nest.

use axum::Router;
use axum::http::{HeaderValue, Method, Uri};
use tower_http::cors::{AllowHeaders, AllowOrigin, CorsLayer};

use crate::common::filters::ApiError;
use crate::config::CorsOrigins;

/// CORS: `*` refleja el origen de cada request; si no, solo los orígenes listados.
/// Los orígenes que no son un valor de header válido se ignoran (nunca coinciden).
fn cors_layer(origins: &CorsOrigins) -> CorsLayer {
    let allow_origin = match origins {
        CorsOrigins::Any => AllowOrigin::mirror_request(),
        CorsOrigins::List(list) => AllowOrigin::list(
            list.iter()
                .filter_map(|origin| HeaderValue::from_str(origin).ok()),
        ),
    };
    CorsLayer::new()
        .allow_origin(allow_origin)
        .allow_methods([
            Method::GET,
            Method::HEAD,
            Method::PUT,
            Method::PATCH,
            Method::POST,
            Method::DELETE,
        ])
        .allow_headers(AllowHeaders::mirror_request())
}

/// Como Nest: una ruta que no existe responde 404 con su cuerpo estándar.
async fn not_found(method: Method, uri: Uri) -> ApiError {
    ApiError::NotFound(format!("Cannot {method} {}", uri.path()))
}

/// Pone las rutas de `app` bajo `/api`, con CORS y el 404 estándar.
pub fn app_setup(app: Router, cors_allow_origins: &CorsOrigins) -> Router {
    Router::new()
        .nest("/api", app)
        .fallback(not_found)
        .method_not_allowed_fallback(not_found)
        .layer(cors_layer(cors_allow_origins))
}

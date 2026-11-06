//! Reintentos, timeouts, `Retry-After` y concurrencia del cliente, contra un servidor en proceso.
#![allow(clippy::unwrap_used)]

mod support;

use std::time::{Duration, Instant};

use chrono::Utc;
use pokemon_data::pokeapi::{ClientConfig, PokeApiClient, PokeApiError};
use support::{Reply, Stub, fast_config};

fn client(stub: &Stub, config: ClientConfig) -> PokeApiClient {
    PokeApiClient::with_config(stub.base_url.clone(), config)
}

#[tokio::test]
async fn fetches_pokemon_in_id_order() {
    // Los ids bajos tardan más: el orden de llegada es el inverso al de los ids.
    let stub =
        Stub::start(|id, _| Reply::ok(id).delayed(Duration::from_millis(u64::from(30 - id) * 5)))
            .await;

    let pokemon = client(&stub, fast_config())
        .fetch_pokemon(20)
        .await
        .unwrap();

    let ids: Vec<i32> = pokemon.iter().map(|p| p.id).collect();
    assert_eq!(ids, (1..=20).collect::<Vec<_>>());
    assert_eq!(stub.hits(), 20);
}

#[tokio::test]
async fn limit_zero_makes_no_requests_and_limit_above_max_is_rejected() {
    let stub = Stub::start(|id, _| Reply::ok(id)).await;
    let client = client(&stub, fast_config());

    assert!(client.fetch_pokemon(0).await.unwrap().is_empty());
    assert!(matches!(
        client.fetch_pokemon(1026).await,
        Err(PokeApiError::InvalidLimit)
    ));
    assert_eq!(stub.hits(), 0);
}

#[tokio::test]
async fn never_has_more_than_eight_requests_in_flight() {
    let stub = Stub::start(|id, _| Reply::ok(id).delayed(Duration::from_millis(60))).await;

    client(&stub, ClientConfig::default())
        .fetch_pokemon(40)
        .await
        .unwrap();

    let max = stub.max_in_flight();
    assert!((2..=8).contains(&max), "máximo simultáneo: {max}");
}

#[tokio::test]
async fn retries_server_errors_and_then_succeeds() {
    let stub = Stub::start(|id, nth| {
        if nth <= 2 {
            Reply::status(500)
        } else {
            Reply::ok(id)
        }
    })
    .await;

    let pokemon = client(&stub, fast_config()).fetch_pokemon(1).await.unwrap();

    assert_eq!(pokemon[0].name, "pokemon-1");
    assert_eq!(stub.hits(), 3);
}

#[tokio::test]
async fn gives_up_after_four_attempts_with_the_last_failure_as_source() {
    let stub = Stub::start(|_, _| Reply::status(503)).await;

    let err = client(&stub, fast_config())
        .fetch_pokemon(1)
        .await
        .unwrap_err();

    assert_eq!(
        err.to_string(),
        format!("GET {} falló tras 4 intentos", stub.url(1))
    );
    assert_eq!(
        std::error::Error::source(&err).unwrap().to_string(),
        "HTTP 503"
    );
    assert_eq!(stub.hits(), 4);
}

#[tokio::test]
async fn does_not_retry_non_retryable_statuses() {
    for status in [400, 404, 418] {
        let stub = Stub::start(move |_, _| Reply::status(status)).await;

        let err = client(&stub, fast_config())
            .fetch_pokemon(1)
            .await
            .unwrap_err();

        assert!(matches!(err, PokeApiError::Status { status: s, .. } if s == status));
        assert_eq!(
            err.to_string(),
            format!("GET {} respondió HTTP {status}", stub.url(1))
        );
        assert_eq!(stub.hits(), 1, "HTTP {status}");
    }
}

#[tokio::test]
async fn retries_429() {
    let stub = Stub::start(|id, nth| {
        if nth == 1 {
            Reply::status(429)
        } else {
            Reply::ok(id)
        }
    })
    .await;

    client(&stub, fast_config()).fetch_pokemon(1).await.unwrap();

    assert_eq!(stub.hits(), 2);
}

#[tokio::test]
async fn waits_with_exponential_backoff_between_attempts() {
    let stub = Stub::start(|id, nth| {
        if nth <= 3 {
            Reply::status(500)
        } else {
            Reply::ok(id)
        }
    })
    .await;
    let config = ClientConfig {
        retry_base_delay: Duration::from_millis(40),
        ..fast_config()
    };

    let started = Instant::now();
    client(&stub, config).fetch_pokemon(1).await.unwrap();

    // 40 + 80 + 160 ms
    assert!(
        started.elapsed() >= Duration::from_millis(280),
        "{:?}",
        started.elapsed()
    );
}

#[tokio::test]
async fn numeric_retry_after_replaces_the_backoff() {
    let stub = Stub::start(|id, nth| {
        if nth == 1 {
            Reply::status(429).header("retry-after", "1")
        } else {
            Reply::ok(id)
        }
    })
    .await;

    let started = Instant::now();
    client(&stub, fast_config()).fetch_pokemon(1).await.unwrap();

    assert!(
        started.elapsed() >= Duration::from_millis(900),
        "{:?}",
        started.elapsed()
    );
}

#[tokio::test]
async fn retry_after_zero_skips_a_long_backoff() {
    let stub = Stub::start(|id, nth| {
        if nth == 1 {
            Reply::status(503).header("retry-after", "0")
        } else {
            Reply::ok(id)
        }
    })
    .await;
    let config = ClientConfig {
        retry_base_delay: Duration::from_secs(60),
        ..fast_config()
    };

    let started = Instant::now();
    client(&stub, config).fetch_pokemon(1).await.unwrap();

    assert!(
        started.elapsed() < Duration::from_secs(5),
        "{:?}",
        started.elapsed()
    );
}

#[tokio::test]
async fn http_date_retry_after_waits_until_that_date() {
    let date = (Utc::now() + chrono::Duration::seconds(2))
        .format("%a, %d %b %Y %H:%M:%S GMT")
        .to_string();
    let stub = Stub::start(move |id, nth| {
        if nth == 1 {
            Reply::status(503).header("retry-after", date.clone())
        } else {
            Reply::ok(id)
        }
    })
    .await;
    let config = ClientConfig {
        retry_base_delay: Duration::from_secs(60),
        ..fast_config()
    };

    let started = Instant::now();
    client(&stub, config).fetch_pokemon(1).await.unwrap();

    let elapsed = started.elapsed();
    assert!(
        elapsed >= Duration::from_millis(500) && elapsed < Duration::from_secs(5),
        "{elapsed:?}"
    );
}

#[tokio::test]
async fn http_date_in_the_past_means_no_wait() {
    let stub = Stub::start(|id, nth| {
        if nth == 1 {
            Reply::status(503).header("retry-after", "Wed, 21 Oct 2015 07:28:00 GMT")
        } else {
            Reply::ok(id)
        }
    })
    .await;
    let config = ClientConfig {
        retry_base_delay: Duration::from_secs(60),
        ..fast_config()
    };

    let started = Instant::now();
    client(&stub, config).fetch_pokemon(1).await.unwrap();

    assert!(
        started.elapsed() < Duration::from_secs(5),
        "{:?}",
        started.elapsed()
    );
}

#[tokio::test]
async fn unparsable_retry_after_falls_back_to_the_backoff() {
    let stub = Stub::start(|id, nth| {
        if nth == 1 {
            Reply::status(503).header("retry-after", "pronto")
        } else {
            Reply::ok(id)
        }
    })
    .await;

    client(&stub, fast_config()).fetch_pokemon(1).await.unwrap();

    assert_eq!(stub.hits(), 2);
}

#[tokio::test]
async fn a_timeout_is_retried_and_then_reported_as_exhausted() {
    let stub = Stub::start(|id, _| Reply::ok(id).delayed(Duration::from_millis(400))).await;
    let config = ClientConfig {
        timeout: Duration::from_millis(50),
        ..fast_config()
    };

    let err = client(&stub, config).fetch_pokemon(1).await.unwrap_err();

    assert!(matches!(err, PokeApiError::Exhausted { attempts: 4, .. }));
    assert_eq!(stub.hits(), 4);
}

#[tokio::test]
async fn a_refused_connection_is_a_retryable_network_error() {
    // Se reserva un puerto libre y se cierra: nadie escucha.
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let client =
        PokeApiClient::with_config(format!("http://127.0.0.1:{port}/api/v2"), fast_config());

    let err = client.fetch_pokemon(1).await.unwrap_err();

    assert!(matches!(err, PokeApiError::Exhausted { attempts: 4, .. }));
    assert!(
        std::error::Error::source(&err)
            .unwrap()
            .to_string()
            .starts_with("error de red")
    );
}

#[tokio::test]
async fn the_first_error_aborts_the_remaining_requests_and_is_the_one_reported() {
    let stub = Stub::start(|id, _| {
        if id == 3 {
            Reply::status(404)
        } else {
            Reply::ok(id).delayed(Duration::from_millis(150))
        }
    })
    .await;

    let err = client(&stub, fast_config())
        .fetch_pokemon(200)
        .await
        .unwrap_err();

    assert_eq!(
        err.to_string(),
        format!("GET {} respondió HTTP 404", stub.url(3))
    );
    assert!(stub.hits() < 50, "peticiones: {}", stub.hits());
}

#[tokio::test]
async fn an_invalid_body_is_not_retried() {
    let stub = Stub::start(|_, _| Reply::json(200, "no es json".into())).await;

    let err = client(&stub, fast_config())
        .fetch_pokemon(1)
        .await
        .unwrap_err();

    assert!(matches!(err, PokeApiError::Decode { .. }));
    assert_eq!(stub.hits(), 1);
}

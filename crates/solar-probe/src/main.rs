#[cfg(not(target_arch = "wasm32"))]
fn main() {
    use std::{
        future::Future,
        sync::Arc,
        task::{Context, Poll, Wake, Waker},
    };
    struct ThreadWake(std::thread::Thread);
    impl Wake for ThreadWake {
        fn wake(self: Arc<Self>) {
            self.0.unpark();
        }
    }
    let waker = Waker::from(Arc::new(ThreadWake(std::thread::current())));
    let mut context = Context::from_waker(&waker);
    let mut future = Box::pin(async {
        if std::env::args().any(|a| a == "--render") {
            return solar_probe::renderer::native_render().await;
        }
        let original = solar_probe::run().await?;
        println!("{}", original.text());
        let visibility = solar_probe::visibility::run().await?;
        Ok::<_, String>(serde_json::to_string_pretty(&visibility).unwrap())
    });
    loop {
        match future.as_mut().poll(&mut context) {
            Poll::Ready(Ok(report)) => {
                println!("{report}");
                break;
            }
            Poll::Ready(Err(error)) => {
                eprintln!("FAIL: {error}");
                std::process::exit(1);
            }
            Poll::Pending => std::thread::park(),
        }
    }
}

#[cfg(target_arch = "wasm32")]
fn main() {}

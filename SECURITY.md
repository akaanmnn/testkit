# Güvenlik notları

Bu depo şirket içi bir araç içerir. Depoyu **private** tutun.

## Depoya asla girmemesi gerekenler

`.gitignore` bunları zaten dışarıda tutuyor; commit öncesi `git status` ile
teyit etmek yine de iyi bir alışkanlık:

| Yol | Neden |
| --- | --- |
| `storage/secrets/` | `storageState.json` dosyaları test edilen uygulamanın **canlı oturum çerezlerini** taşır |
| `storage/files/` | Analistlerin yüklediği gerçek belgeler, muhtemelen gerçek müşteri verisi |
| `storage/artifacts/` | Ekran görüntüleri uygulamanın verisini gösterir |
| `prisma/*.db` | Veri setleri gerçek test verisi içerir |
| `.env` | Yollar ve portlar; ileride sır barındırabilir |
| `testkit-agent.config.json` | Agent token'ı |

## Token'lar

Agent token'ı bir kimlik değil, yalnızca makine eşleştirmesidir. Sunucu
token'ın kendisini değil sha256 özetini saklar. Bir token sızdıysa web
arayüzünden **Yeni token** ile döndürün; eski token anında geçersiz olur.

## Ağ

Sunucu 3001 portunu şirket içi ağa açar. Dışarıdan erişime kapalı olmalıdır:
MVP'de kimlik doğrulama yoktur, sayfaya erişen herkes senaryo çalıştırabilir.

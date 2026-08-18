# TestKit

Analistlerin kod yazmadan web testi oluşturup çalıştırabildiği, şirket içi bir
test otomasyon aracı.

Analist tarayıcıda uygulamayı normal kullanır, TestKit yaptıklarını kaydeder ve
bunu tekrar çalıştırılabilir bir senaryoya çevirir. Test verisi senaryodan ayrı
tutulur: aynı "Müşteri Oluşturma" senaryosu, farklı veri setleriyle istenildiği
kadar koşturulur.

```
Senaryo: Müşteri Oluşturma          ← adımlar, veri yok
   ├── Veri seti "Ahmet"    → Ahmet  / Yılmaz / ahmet.xlsx
   └── Veri seti "Mehmet"   → Mehmet / Kaya   / mehmet.xlsx
```

## Ne yapar

- **Kaydeder** — Kayıt, analistin **kendi bilgisayarındaki** Chromium'da olur.
  Kendi oturumuyla girer, kendi diskinden dosya seçer. Tıklama, form doldurma,
  seçim, işaretleme, dosya yükleme ve sayfa geçişleri kaydedilir.
- **Temizler** — Yalnızca alanı odaklayan tıklamalar, `Tab` tuşları ve
  tuş tuş oluşan tekrarlı doldurmalar ayıklanır; hedefler okunabilir biçimde
  tutulur: `getByRole('button', { name: 'Kaydet' })`
- **Değişkene çevirir** — Koşular arasında değişen değerler için değişken önerir
  (`Müşteri Adı` → `musteriAdi`). Analist onaylar, senaryo veriden bağımsız kalır.
- **Veri setleriyle çalıştırır** — Metin değerleri ve gerçek dosyalar veri
  setinde durur; bir senaryo birden çok veri setiyle tek hamlede koşturulabilir.
- **Sonucu gösterir** — Adım adım ✅ / ❌ / ⏭, her adımın ekran görüntüsü, canlı
  akış, PASS/FAIL ve koşu geçmişi. Geçmiş koşular kullandıkları veriyi de
  saklar; veri seti sonradan değişse bile geçmiş değişmez.

## Hızlı başlangıç

Gereken: Node.js 20 LTS veya 22 LTS.

```bash
git clone https://github.com/akaanmnn/testkit.git
cd testkit
npm install
cp .env.example .env
npx prisma migrate deploy
npx playwright install chromium
npm start
```

`http://localhost:3001` açılır. Windows'ta bunların hepsini
**`TestKit Server Baslat.cmd`** dosyasına çift tıklayarak da yapabilirsiniz.

Kayıt alabilmek için bir de agent gerekir: arayüzde makineyi kaydedin,
**Config indir** ile inen dosyayı `apps/agent/` klasörüne koyun ve
`TestKit Agent Baslat.cmd` dosyasını çalıştırın. Ayrıntılı anlatım:
[KURULUM.md](KURULUM.md).

## Nasıl çalışır

Kayıt analistin bilgisayarında, koşu merkezde. Agent hiçbir port açmaz; kendisi
sunucuya bağlanır.

```
ANALİST PC                                  ŞİRKET İÇİ SUNUCU
  Tarayıcı ──► Web arayüzü ─────────────────►  API · SQLite · storage/
  TestKit Agent ── giden WebSocket ─────────►  agent bağlantısı
    └─► yerel Chromium                          └─► headless Chromium (koşular)
        (playwright codegen)
```

Kaydedilen aksiyonlar ham JSONL olarak sunucuya akar; yorumlama, temizlik ve
değişken çıkarımı sunucuda yapılır. Agent bilinçli olarak "aptal" tutulmuştur:
tarayıcıyı açar, satırları iletir. Böylece bir çeviri hatası düzeltmek sunucuyu
güncellemekten ibarettir, analist makinelerine dağıtım gerektirmez.

Koşular DSL'i doğrudan Playwright API'siyle yorumlar; `.spec.ts` dosyası
üretilmez. Gerekçeleri ve diğer tasarım kararları:
[docs/mimari.md](docs/mimari.md).

## Teknoloji

| Katman | Kullanılan |
| --- | --- |
| Arayüz | React 18, TypeScript, Vite |
| Sunucu | Node.js, Express, WebSocket (`ws`), SSE |
| Veritabanı | SQLite + Prisma |
| Tarayıcı otomasyonu | Playwright 1.56.0 (tam sabitlenmiş sürüm) |
| Dosyalar | Filesystem (`storage/`); veritabanında yalnızca üstveri |

Kuyruk, önbellek, konteyner orkestrasyonu ya da harici servis yok. İki analistin
kullandığı bir araç için tek process yeterli.

## Klasör yapısı

```
apps/server/     API, WebSocket, koşucu, SQLite
apps/agent/      analist makinesinde çalışır, yerel kaydı yürütür
apps/web/        React arayüzü
packages/shared/ üç uygulamanın paylaştığı protokol, DSL ve API tipleri
prisma/          veri modeli
docs/            mimari ve tasarım kararları
storage/         dosyalar, ekran görüntüleri, oturum bilgileri (git dışı)
```

## Komutlar

| Komut | Ne yapar |
| --- | --- |
| `npm start` | Arayüzü derler ve her şeyi tek portta yayınlar |
| `npm run dev` | Geliştirme: sunucu + canlı yenilemeli arayüz |
| `npm run dev:agent` | Agent'ı çalıştırır |
| `npm run typecheck` | Dört pakette `tsc --noEmit` |
| `npm run db:migrate` | Veritabanı şemasını uygular |
| `npm run db:studio` | Veritabanını tarayıcıda açar |
| `npm run smoke:jsonl` | Playwright kayıt çıktısının formatını doğrular |

## Dokümanlar

| Dosya | İçerik |
| --- | --- |
| [KURULUM.md](KURULUM.md) | Sunucu ve analist makinesi kurulumu, sorun giderme |
| [docs/mimari.md](docs/mimari.md) | Tasarım kararları ve gerekçeleri |
| [SECURITY.md](SECURITY.md) | Depoya girmemesi gerekenler, token ve ağ notları |
| [GITHUB.md](GITHUB.md) | Depoyu GitHub'a alma ve güncelleme akışı |

## Durum

Kayıt, senaryo yönetimi, veri setleri, dosya yükleme, oturum profilleri ve
sunucu üzerinde koşturma tamamlandı.

Sıradaki başlıklar: sürükle-bırak adım sıralama, agent üzerinde gözle izlenen
hata ayıklama koşusu, agent'ın tek dosya olarak paketlenmesi, iframe desteği.

## Notlar

Depo şirket içi kullanım içindir ve private tutulmalıdır; MVP'de kimlik
doğrulama yoktur, sunucuya erişen herkes senaryo çalıştırabilir. Ayrıntılar
[SECURITY.md](SECURITY.md) dosyasında.

// 无限五代 · 命中词汇扩展数据 · COMMAND_VOCAB_P2（生成物，不要手改）
//
// 改词条 → 改 data/vocab/*.json → 跑 `npm run vocab:build` 重新生成。
// 规则与护栏在 data/vocabulary.mjs；合并进领域包的动作在 data/scenarios.mjs 里完成。
//
// 源文件：A-offense-core.json · B-reverse-malware.json · C-network-cloud.json · D-eng-crypto-data-ai.json · E-curated-fixes.json · F-v0140-newdomains.json · G-v0140-backfill.json · H-v0240-newdomains.json · I-v0260-newdomains.json · J-v0260-thicken.json · K-v0270-newdomains.json
export const COMMAND_VOCAB_P2 = {
  voip: [
    "nmap -sU -p 5060 --script sip-methods TARGET",
    "svmap 192.0.2.0/24",
    "svcrack -u 1001 -d WORDLIST -r HOST",
    "sngrep -d any -O /tmp/OUTFILE.pcap",
    "nmap -sV -p 80,443,5060,5061 TARGET -oN /tmp/OUTFILE",
    "sipp -sn uac HOST -m 1 -trace_stat",
  ],
  virtualization: [
    "nmap -sV -p 443,902,5988,5989 TARGET",
    "curl -sk https://HOST/ui/ | head -20",
    "govc about -u USER:PASS@HOST -k",
    "esxcli --server HOST --username USER system version get",
    "vmkfstools -i /vmfs/volumes/ds1/FILE.vmdk -d thin /tmp/OUTFILE.vmdk",
    "python3 FILE.py --host HOST --user USER --password PASS",
  ],
  diffusion: [
    "python3 -c 'import torch;print(torch.__version__, torch.cuda.is_available())'",
    "python3 -m pip show diffusers | head -3",
    "python3 FILE.py --model MODEL --prompt PROMPT --steps 28 --cfg 7 --seed 42 --out /tmp/OUTFILE.png",
    "accelerate launch train_dreambooth_lora_sdxl.py --pretrained_model_name_or_path MODEL --output_dir /tmp/OUTFILE",
    "curl -s -X POST http://HOST:8188/prompt -d @/tmp/OUTFILE.json",
  ],
  speech_ai: [
    "ffmpeg -i FILE.wav -ar 16000 -ac 1 /tmp/OUTFILE.wav",
    "python3 -c 'import torchaudio;print(torchaudio.__version__)'",
    "python3 -m TTS.bin.synthesize --text 'TEXT' --model_path MODEL --out_path /tmp/OUTFILE.wav",
    "python3 FILE.py --enroll ROLE_A.wav --test FILE.wav --model ecapa",
    "python3 FILE.py --scorer cm --input /tmp/OUTFILE.wav --threshold 0.5",
    "python3 -c 'import speechbrain;print(speechbrain.__version__)'",
  ],
  post_quantum: [
    "openssl genpkey -algorithm ML-KEM-768 -out /tmp/TARGET-pq.key",
    "openssl genpkey -algorithm ML-DSA-65 -out /tmp/TARGET-sign.key",
    "openssl pkey -in /tmp/TARGET-pq.key -text -noout | head -12",
    "openssl s_client -connect HOST:443 -groups X25519MLKEM768 -tls1_3 </dev/null 2>&1 | grep -iE \"group|negotiated\"",
    "python3 -c \"from pqcrypto.kem import ml_kem_768 as k; pk,sk=k.generate_keypair(); print(len(pk),len(sk))\"",
    "openssl list -providers -verbose 2>&1 | grep -i oqs",
  ],
  wallet: [
    "cast wallet new-mnemonic --words 12",
    "cast wallet address --private-key $PRIVKEY",
    "cast wallet sign --private-key $PRIVKEY --data 0x1234",
    "node -e \"const{Wallet}=require('ethers');console.log(new Wallet('0x'+'11'.repeat(32)).address)\"",
    "python3 -c \"from embit import bip39,bip32; print(bip32.HDKey.from_seed(bip39.mnemonic_to_seed(WORDLIST)).to_base58())\"",
  ],
  graph_data: [
    "docker run --rm neo4j:5 cypher-shell -a bolt://HOST:7687 -u neo4j -p PASSWORD \"MATCH (n) RETURN count(n)\"",
    "python3 -c \"import rdflib; g=rdflib.Graph(); g.parse('/tmp/FILE.ttl'); print(len(g))\"",
    "python3 -c \"import networkx as nx; print(len(nx.pagerank(nx.karate_club_graph())))\"",
    "curl -s -H \"Content-Type: application/sparql-query\" --data-binary @/tmp/FILE.rq http://HOST:3030/ds/query",
    "python3 -c \"import rdflib; g=rdflib.Graph(); g.parse('/tmp/FILE.ttl'); print(len(list(g)))\"",
  ],
  geospatial: [
    "ogrinfo -so /tmp/FILE.geojson",
    "ogr2ogr -f GeoJSON /tmp/OUTFILE.geojson /tmp/FILE.shp -t_srs EPSG:4326",
    "python3 -c \"import geopandas as gpd; g=gpd.read_file('/tmp/FILE.geojson'); print(g.crs, g.is_valid.all())\"",
    "osmium tags-filter /tmp/FILE.osm.pbf w/highway -o /tmp/OUTFILE.osm.pbf",
    "python3 -c \"import movingpandas as mpd; print(mpd.__version__)\"",
  ],
  embedded_dev: [
    "arm-none-eabi-gcc -mcpu=cortex-m4 -mthumb -c FILE.c -o /tmp/OUTFILE.o",
    "arm-none-eabi-size /tmp/FILE.elf",
    "arm-none-eabi-objdump -d /tmp/FILE.elf | head -40",
    "openocd -f interface/stlink.cfg -f target/stm32f4x.cfg -c \"program /tmp/FILE.elf verify reset exit\"",
    "qemu-system-arm -M lm3s6965evb -kernel /tmp/FILE.elf -nographic",
    "pio run -e TARGET_ENV -t upload",
  ],
  i18n: [
    "xgettext -o /tmp/OUTFILE.pot --from-code=UTF-8 $(find src -name \"*.ts\")",
    "msgfmt -o /tmp/OUTFILE.mo /tmp/FILE.po",
    "msgmerge -U /tmp/FILE.po /tmp/OUTFILE.pot",
    "npx lingui extract --locale zh -o /tmp/OUTFILE.po",
    "python3 -c \"from babel import Locale; print(Locale.parse('zh_CN').languages['en'])\"",
  ],
  perf_eng: [
    "k6 run --vus 50 --duration 30s /tmp/FILE.js",
    "wrk -t4 -c200 -d30s --latency http://HOST/",
    "perf record -F 99 -g -p TARGET -- sleep 30",
    "perf script | flamegraph.pl > /tmp/OUTFILE.svg",
    "hyperfine --warmup 3 \"curl -s -o /dev/null http://HOST/\"",
    "npx autocannon -c 100 -d 20 http://HOST/",
  ],
  comic: [
    "pandoc -f markdown -t html --standalone storyboard.md -o storyboard.html — 分镜稿转可打印排版稿",
    "grep -c '^|' storyboard.md — 统计画格表行数（每格一行）",
    "typst compile storyboard.typ storyboard.pdf — 把画格与气泡说明排成 PDF",
    "python3 -c \"from PIL import Image; Image.new('RGB',(1200,1800)).save('panel.png')\" — 生成占位画格底图",
  ],
  speech_writing: [
    "espeak-ng -v zh -s 150 -f speech.txt -w speech.wav — 合成朗读音频用于估算时长",
    "ffprobe -v error -show_entries format=duration -of csv=p=0 speech.wav — 读实际时长，按 80% 折算现场语速",
    "pandoc speech.md -o speech-large.pdf -V fontsize=20pt --pdf-engine=xelatex — 生成提词器大字版",
    "wc -m speech.txt — 统计字数，按 220 字/分钟折算总时长",
  ],
  patent: [
    "pandoc claims.md -o claims.docx --reference-doc=patent-tpl.docx — 权利要求书套模板出 DOCX",
    "git diff --word-diff claims.md — 权项逐词对比，查修改是否超范围",
    "awk '{print \"[\"NR\"] \"$0}' claims.txt > claims-numbered.txt — 权利要求逐条编号",
    "pandoc -f markdown -t docx disclosure.md -o disclosure.docx — 交底书转 Word 交稿",
  ],
  email_doc: [
    "pandoc mail.md -o mail.docx --reference-doc=gongwen-tpl.docx — 商务邮件与公文套模板",
    "pandoc gongwen.md -o gongwen.pdf --pdf-engine=xelatex -V fontsize=16pt — 公文排版出 PDF",
    "hunspell -l -d en_US mail.txt — 英文邮件拼写检查",
    "git diff --stat templates/ — 公文与邮件模板改动留痕",
  ],
};

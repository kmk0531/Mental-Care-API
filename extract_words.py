import os
import re
import sys
import MeCab
from collections import Counter
from sklearn.feature_extraction.text import TfidfVectorizer

# ---------- 불용어 로드 ----------
STOPWORDS_PATH = os.path.join(os.path.dirname(__file__), "korean_stopwords.txt")
stopwords = set()
if os.path.exists(STOPWORDS_PATH):
    with open(STOPWORDS_PATH, encoding="utf-8") as f:
        stopwords = {w.strip() for w in f if w.strip()}

# 자주 등장하지만 의미 없는 일반 단어를 추가로 제거
extra_stop = {
    "하루", "종일", "오늘", "기분", "시간", "생각",
    "준비", "정신", "조금", "정도", "정말", "그냥", "마음"
}
stopwords |= extra_stop

# ---------- 입력 읽기 ----------
input_text = sys.stdin.read().strip()

# ---------- MeCab 초기화 ----------
mecab = MeCab.Tagger("-d /opt/homebrew/lib/mecab/dic/mecab-ko-dic -r /opt/homebrew/etc/mecabrc")

def extract_tokens(text: str):
    """
    NNG, NNP 형태소 중 2글자 이상이면서 불용어가 아닌 토큰 반환
    """
    node = mecab.parseToNode(text)
    tokens = []
    while node:
        if node.feature.startswith(("NNG", "NNP")):  # 일반·고유 명사
            w = node.surface
            if len(w) > 1 and w not in stopwords:
                tokens.append(w)
        node = node.next
    return tokens

tokens = extract_tokens(input_text)

# ---------- TF‑IDF ----------
vectorizer = TfidfVectorizer(
    tokenizer=lambda x: x,           # 이미 토큰 리스트
    preprocessor=lambda x: x,
    token_pattern=None,
    min_df=1,          # 한 문서라면 1 이상
    max_df=1.0,        # 문서 비율 제한 제거
    ngram_range=(1, 2)               # 1~2 gram
)

tfidf = vectorizer.fit_transform([tokens])
scores = tfidf.toarray()[0]
vocab = vectorizer.get_feature_names_out()
scored = sorted(zip(vocab, scores), key=lambda x: x[1], reverse=True)

# 필터링 로직 적용
filtered_words = []
for w, s in scored:
    if s <= 0:        # 0 이하 점수 제거
        continue
    # 동일 단어 반복 bigram 제거 (예: '공부 공부')
    if " " in w:
        parts = w.split()
        if len(parts) == 2 and parts[0] == parts[1]:
            continue
        # bigram 안에 불용어 포함 시 제거
        if any(p in stopwords for p in parts):
            continue
    # 단어 자체가 불용어인 경우 제거
    if w in stopwords:
        continue
    filtered_words.append(w)

# ---------- 상위 2개 단어 출력 ----------
top_words = filtered_words[:2] if filtered_words else [w for w, _ in scored[:2]]
print(",".join(top_words))
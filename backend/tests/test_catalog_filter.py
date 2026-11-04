from app.catalog_filter import word_reason,sense_reason
from nltk.corpus import wordnet as wn

def test_function_symbols_and_abbreviations():
    for word in ['the','be','and','of','i','x','a1','UFO','John']:
        assert word_reason(word)
    assert word_reason('bank') is None

def test_proper_names_acronyms_and_ordinary_senses():
    for word in ['london','dna']:
        assert all(sense_reason(word,s) for s in wn.synsets(word))
    assert any(sense_reason('bank',s) is None for s in wn.synsets('bank'))

def test_archaic_and_unattested_rejected():
    class Lemma:
        def name(self): return 'word'
        def count(self): return 0
    class Sense:
        def definition(self): return 'an archaic word for a thing'
        def instance_hypernyms(self): return []
        def lemmas(self): return [Lemma()]
    assert sense_reason('word',Sense())=='archaic_rare_or_abbreviation_sense'

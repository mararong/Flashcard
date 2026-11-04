"""Conservative WordNet candidate policy, applied per sense (not just spelling)."""
import re
POLICY_VERSION='learner-content-v1'
FUNCTION_WORDS=set('''a an the this that these those i me my mine myself we us our ours you your yours he him his she her hers it its they them their theirs who whom whose which what where when why how all any both each either every neither none some such another other be am is are was were been being do does did done have has had having can could shall should will would may might must ought need dare and or but nor so yet if unless although though because since until while whereas as than then whether of in on at to for from by with without about above below over under into onto upon out off up down through across between among against around before after during within beyond near via per not no yes too very quite rather also just even only ever never always already still again here there thus hence therefore either neither once twice much many few little less least more most enough same own else'''.split())
BAD_SENSE=re.compile(r'\b(archaic|obsolete|obsolescent|antiquated|rare sense|rare usage|rarely used|dialectal|dialect|abbreviation|abbreviated|acronym|initialism|chemical symbol|symbol for|letter of the|alphabet|unit of measurement|monetary unit)\b',re.I)

def word_reason(word):
    if word in FUNCTION_WORDS:return 'function_word'
    if not re.fullmatch('[a-z]{3,24}',word):return 'symbol_abbreviation_or_proper_spelling'
    return None

def sense_reason(word,syn):
    if BAD_SENSE.search(syn.definition()):return 'archaic_rare_or_abbreviation_sense'
    if syn.instance_hypernyms():return 'proper_name_instance'
    matches=[l for l in syn.lemmas() if l.name().lower()==word]
    if not matches or all(l.name()!=word for l in matches):return 'proper_name_or_acronym'
    # A secondary sense with no attested WordNet tag counts is too uncertain to publish automatically.
    if all(l.count()==0 for l in matches):return 'unattested_sense_needs_review'
    return None

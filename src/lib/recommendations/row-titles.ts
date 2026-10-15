import type {GenreReason,DynamicMedium,DynamicKind} from './model';

/** Wording varies; the evidence and selection behind a row do not. */
export const genreTitlePatterns:Record<GenreReason,readonly string[]> = {
  liked: [
    '{Genre} {items} you might love',
    'You might like these {genre} {items}',
    '{Genre} {items} that might interest you',
    'Because you enjoy {genre} {items}',
    'More {genre} {items} for you',
    'Find a new favourite among these {genre} {items}',
    'A few more {genre} {items} to try',
    'Your next discovery in {genre} {items}',
  ],
  watched: [
    'More {genre} {items} to explore',
    'Keep exploring {genre} {items}',
    'You might like more of these {genre} {items}',
    '{Genre} {items} worth a look',
    'Something else in {genre} {items}',
    'A few more {genre} {items} for you',
  ],
  saved: [
    'Explore {genre} {items}',
    '{Genre} {items} that might interest you',
    'You might like these {genre} {items}',
    'Take a look at these {genre} {items}',
    'Discover more {genre} {items}',
    'A few {genre} {items} to consider',
  ],
  explore: [
    'A new direction in {items}: {genre}',
    'Something different: {genre} {items}',
    'Explore a different side of {items}: {genre}',
    'A change of pace with {genre} {items}',
    '{Genre} {items} beyond your usual picks',
    'A little outside your usual {items}: {genre}',
  ],
};
export const relatedTitlePatterns:Record<Exclude<GenreReason,'explore'>,readonly string[]> = {
  liked: [
    'More like {title}',
    'Because you liked {title}',
    'If you enjoyed {title}, try these',
    'For fans of {title}',
    'You might also like these after {title}',
  ],
  watched: [
    'More like {title}',
    'Something else like {title}',
    'More to explore after {title}',
    'If you enjoyed {title}, try these',
    'Take a look beyond {title}',
  ],
  saved: [
    'More like {title}',
    'Something similar to {title}',
    'Explore more like {title}',
    'If {title} caught your eye, try these',
    'A few more ideas alongside {title}',
  ],
};
const popularTitlePatterns = [
  'Popular {items} with friends',
  '{Items} popular with friends',
  'Popular among friends: {items}',
] as const;
const recommendationTitlePatterns = [
  '{Items} you might like',
  '{Items} picked for you',
  '{Items} worth discovering',
  'Find your next favourite among these {items}',
  'A few {items} that might interest you',
] as const;

function choose(patterns:readonly string[],seed:string,key:string) {
  if(!seed)return patterns[0];
  let hash=2166136261;
  for(const character of `${seed}:${key}`)hash=Math.imul(hash^character.charCodeAt(0),16777619);
  return patterns[(hash>>>0)%patterns.length];
}
function capitalize(value:string){return value?value[0].toUpperCase()+value.slice(1):value;}
export function recommendationRowTitle(category:DynamicMedium,seed='') {
  const items=category==='screen'?'movies and shows':category==='game'?'games':category==='reading'?'books and comics':'albums';
  return choose(recommendationTitlePatterns,seed,`recommendations:${category}`).replaceAll('{Items}',capitalize(items)).replaceAll('{items}',items);
}
function genreName(genre:string){
  const aliases:Record<string,string>={
    'role-playing (rpg)':'role-playing', 'sci-fi & fantasy':'science fiction and fantasy',
    'science fiction':'science fiction', 'action & adventure':'action and adventure',
    'war & politics':'war and politics', 'r&b':'R&B', 'rnb':'R&B', 'rpg':'RPG',
  };
  const normalized=genre.trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US');
  return aliases[normalized]??normalized;
}
/** Row and full-grid headings use the same visit seed, including during refreshes. */
export function genreRowTitle(category:DynamicMedium,genre:string,kind?:DynamicKind,reason:GenreReason='saved',seed='') {
  const name=genreName(genre);
  const items=kind==='movie'?'movies':kind==='show'?'shows':kind==='book'?'books':kind==='comic'?'comics':category==='game'?'games':category==='music'?'albums':category==='reading'?'books and comics':'movies and shows';
  const pattern=choose(genreTitlePatterns[reason],seed,`genre:${category}:${kind??'all'}:${name}:${reason}`);
  return pattern.replaceAll('{Genre}',capitalize(name)).replaceAll('{genre}',name).replaceAll('{items}',items);
}
export function relatedRowTitle(title:string,reason:GenreReason='saved',seed='') {
  const evidence=reason==='explore'?'saved':reason;
  return choose(relatedTitlePatterns[evidence],seed,`related:${title}:${evidence}`).replaceAll('{title}',title);
}
export function popularRowTitle(category:DynamicMedium,seed='') {
  const items=category==='screen'?'movies and shows':category==='game'?'games':category==='reading'?'books and comics':'music';
  return choose(popularTitlePatterns,seed,`popular:${category}`).replaceAll('{Items}',capitalize(items)).replaceAll('{items}',items);
}

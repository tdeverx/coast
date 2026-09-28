import type { CastMember, Metadata } from '$lib/providers/contracts';
export interface Review {
  id: string;
  author: string;
  text: string;
  date?: string;
  rating?: number;
  spoiler: boolean;
  url: string;
}
export interface MediaInsights {
  source: 'TMDB' | 'Trakt';
  incomplete?: boolean;
  url: string;
  rating?: number;
  votes?: number;
  ratingDistribution?: { value: number; count: number }[];
  metrics?: { label: string; value: number }[];
  facts: { label: string; value: string }[];
  crew: CastMember[];
  reviews: Review[];
  page: number;
  pages: number;
}
export interface PersonDetails {
  id: number;
  name: string;
  biography: string;
  portrait?: string;
  department?: string;
  birthday?: string;
  deathday?: string;
  birthplace?: string;
  credits: {
    metadata: Metadata;
    role: string;
    department: 'acting' | 'crew';
    creditDepartment?: string;
    popularity: number;
  }[];
}

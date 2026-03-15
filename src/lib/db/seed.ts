import { db } from './index';
import { projects, verticals, variants } from './schema';

async function seed() {
  console.log('Seeding database...');

  // Insert project
  const [project] = await db.insert(projects).values({
    name: 'Acquisition Q1 2026',
    funnel_focus: 'acquisition',
    status: 'active',
    significance_threshold: 0.95,
  }).returning();

  console.log('Created project:', project.id);

  // Insert Creators vertical
  const [creatorsVertical] = await db.insert(verticals).values({
    project_id: project.id,
    slug: 'creators',
    name: 'Creators',
    description: 'Independent filmmakers, YouTubers, and content creators who want to produce AI-generated movies and episodes',
    status: 'active',
    traffic_split_strategy: 'equal',
  }).returning();

  // Insert Educators vertical
  const [educatorsVertical] = await db.insert(verticals).values({
    project_id: project.id,
    slug: 'educators',
    name: 'Educators',
    description: 'Teachers, professors, and educational content creators using AI video for learning materials',
    status: 'active',
    traffic_split_strategy: 'equal',
  }).returning();

  console.log('Created verticals:', creatorsVertical.id, educatorsVertical.id);

  // Creators variants
  await db.insert(variants).values([
    {
      vertical_id: creatorsVertical.id,
      slug: 'variant-a',
      version: 1,
      status: 'active',
      traffic_weight: 50,
      config: {
        headline: 'Turn Your Ideas Into Movies',
        subheadline: 'Popcorn uses AI to transform your scripts, storyboards, and ideas into fully produced cinematic videos — no crew, no budget, no limits.',
        body_copy: "Whether you're an indie filmmaker, a YouTuber, or a storyteller with a vision, Popcorn gives you a professional production studio in your browser. Write your story. Choose your style. Hit render. Your movie is ready in minutes.",
        cta_primary: {
          text: 'Start Creating Free',
          action: 'https://popcorn.app/signup?utm_content=creators-variant-a',
        },
        cta_secondary: {
          text: 'See Examples',
          action: 'https://popcorn.app/examples',
        },
        social_proof: [
          '"I made my first short film in a weekend. Popcorn is insane." — Alex R., filmmaker',
          '"My YouTube channel views tripled after switching to AI-generated content." — Jamie L.',
          '"It\'s like having a full production team on demand." — Sam K., content creator',
        ],
        template: 'hero-centered',
        theme: {
          primary: '#F5A623',
          background: '#0A0A0A',
          text: '#FFFFFF',
        },
        meta_title: 'Turn Your Ideas Into Movies | Popcorn AI',
        meta_description: 'Create AI-generated movies and videos from your ideas. No crew needed. Start free.',
      },
    },
    {
      vertical_id: creatorsVertical.id,
      slug: 'variant-b',
      version: 1,
      status: 'active',
      traffic_weight: 50,
      config: {
        headline: 'Your Story Deserves to Be Seen',
        subheadline: "Stop letting budget and crew hold back your creative vision. Popcorn's AI turns your words into cinematic reality.",
        body_copy: "You have stories worth telling. Popcorn makes sure the world can see them. From short films to serialized episodes, our AI handles production so you can focus on what matters — the story. Join thousands of creators already making movies with Popcorn.",
        cta_primary: {
          text: 'Make Your First Movie',
          action: 'https://popcorn.app/signup?utm_content=creators-variant-b',
        },
        cta_secondary: {
          text: 'Watch Demo',
          action: 'https://popcorn.app/demo',
        },
        hero_image: '/images/creators-hero.jpg',
        social_proof: [
          '50,000+ creators on Popcorn',
          'Average 4.8/5 rating from filmmakers',
          'Featured in TechCrunch, The Verge, Wired',
        ],
        template: 'hero-split',
        theme: {
          primary: '#F5A623',
          background: '#0A0A0A',
          text: '#FFFFFF',
        },
        meta_title: 'Your Story Deserves to Be Seen | Popcorn AI',
        meta_description: "AI-powered movie creation for storytellers. Turn your vision into cinematic reality — no crew, no budget limits.",
        og_image: '/images/creators-og.jpg',
      },
    },
  ]);

  // Educators variants
  await db.insert(variants).values([
    {
      vertical_id: educatorsVertical.id,
      slug: 'variant-a',
      version: 1,
      status: 'active',
      traffic_weight: 50,
      config: {
        headline: 'Bring Lessons to Life',
        subheadline: 'Create AI-generated educational videos that captivate students and make complex concepts click — in minutes, not days.',
        body_copy: "Students remember what they see. Popcorn transforms your lesson plans, lecture notes, and educational content into engaging AI-generated videos. Increase comprehension, reduce prep time, and make learning unforgettable.",
        cta_primary: {
          text: 'Try It Free',
          action: 'https://popcorn.app/signup?utm_content=educators-variant-a',
        },
        cta_secondary: {
          text: 'See Classroom Examples',
          action: 'https://popcorn.app/education/examples',
        },
        social_proof: [
          '"My students\' test scores improved 23% after I started using Popcorn for lessons." — Prof. Chen, Stanford',
          '"I create a week of video content in one afternoon now." — Ms. Thompson, High School Teacher',
          '"Best ed-tech tool I\'ve used in 15 years of teaching." — Dr. Martinez, University Professor',
        ],
        template: 'hero-centered',
        theme: {
          primary: '#4CAF50',
          background: '#0A0A0A',
          text: '#FFFFFF',
        },
        meta_title: 'Bring Lessons to Life with AI Video | Popcorn',
        meta_description: 'Create engaging educational videos with AI. Turn lesson plans into cinematic learning experiences. Try free.',
      },
    },
    {
      vertical_id: educatorsVertical.id,
      slug: 'variant-b',
      version: 1,
      status: 'active',
      traffic_weight: 50,
      config: {
        headline: 'Teaching Just Got Cinematic',
        subheadline: 'Transform any lesson into a visually stunning AI video. Your students will actually remember it.',
        body_copy: "Lectures compete with TikTok, YouTube, and Netflix for student attention. Win that competition. Popcorn turns your educational content into cinematic AI videos that meet students where they are. Create once, engage forever.",
        cta_primary: {
          text: 'Create a Lesson Now',
          action: 'https://popcorn.app/signup?utm_content=educators-variant-b',
        },
        cta_secondary: {
          text: 'How It Works',
          action: 'https://popcorn.app/education/how-it-works',
        },
        hero_image: '/images/educators-hero.jpg',
        social_proof: [
          '10,000+ educators using Popcorn',
          'Used in 500+ schools and universities',
          'Average 40% increase in student engagement',
        ],
        template: 'hero-split',
        theme: {
          primary: '#4CAF50',
          background: '#0A0A0A',
          text: '#FFFFFF',
        },
        meta_title: 'Teaching Just Got Cinematic | Popcorn AI',
        meta_description: 'AI-generated educational videos that students actually watch. Turn your lessons into cinematic experiences.',
        og_image: '/images/educators-og.jpg',
      },
    },
  ]);

  console.log('Seed complete.');
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});

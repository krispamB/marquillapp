import { 
  Search, 
  Lightbulb, 
  FileText, 
  Edit3, 
  Calendar, 
  Sparkles, 
  Zap 
} from 'lucide-react';

interface Feature {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}

const features: Feature[] = [
  {
    icon: Search,
    title: 'Automated Research',
    description: 'Automatically gather relevant information and insights from multiple sources to fuel your LinkedIn content creation.',
  },
  {
    icon: Lightbulb,
    title: 'Insight Extraction',
    description: 'Extract key insights and talking points from research materials to create compelling LinkedIn posts.',
  },
  {
    icon: FileText,
    title: 'AI-Generated Posts',
    description: 'Generate professional, engaging LinkedIn posts tailored to your voice and audience in seconds.',
  },
  {
    icon: Edit3,
    title: 'Post Editing',
    description: 'Refine and customize AI-generated content with intuitive editing tools to match your style perfectly.',
  },
  {
    icon: Calendar,
    title: 'Scheduling Tools',
    description: 'Plan and schedule your LinkedIn content calendar to maintain consistent engagement with your network.',
  },
  {
    icon: Sparkles,
    title: 'Topic Suggestions',
    description: 'Get intelligent topic recommendations based on trending discussions and your professional interests.',
  },
  {
    icon: Zap,
    title: 'Fast Workflow',
    description: 'Streamline your content creation process from research to publication with an efficient, intuitive workflow.',
  },
];

export default function Features() {
  return (
    <section id="features" className="py-20 bg-surface" aria-labelledby="features-heading">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 id="features-heading" className="text-3xl sm:text-4xl font-bold text-text-primary mb-4">
            Powerful Features for LinkedIn Content Creation
          </h2>
          <p className="text-lg text-text-secondary max-w-2xl mx-auto">
            Everything you need to create engaging LinkedIn content that resonates with your professional network
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <article
                key={index}
                className="bg-background rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow duration-300 focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2"
              >
                <div className="flex items-center justify-center w-12 h-12 bg-primary/10 rounded-lg mb-4" aria-hidden="true">
                  <Icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-semibold text-text-primary mb-3">
                  {feature.title}
                </h3>
                <p className="text-text-secondary leading-relaxed">
                  {feature.description}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

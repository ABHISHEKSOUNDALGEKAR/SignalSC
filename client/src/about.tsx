type Link = { label: string; href: string };
type Person = { name: string; role: string; photo: string; bio: string; links: Link[] };

const team: Person[] = [
  {
    name: 'Abhishek Soundalgekar',
    role: 'Lead developer · Product idea',
    photo: '/team/abhishek-soundalgekar.jpg',
    bio: 'M.S. Computer Science student at USC, graduating December 2026, with about three years of engineering experience across ML systems, full-stack development and backend infrastructure. Abhishek came up with the idea for SignalSC and led its development, from the flyer reader and event feeds to search and the organizer workflow.',
    links: [
      { label: 'LinkedIn', href: 'https://www.linkedin.com/in/abhishekmsoundalgekar/' },
      { label: 'Portfolio', href: 'https://is.gd/abhisound' },
      { label: 'LeetCode', href: 'https://leetcode.com/u/abhishek_soundalgekar/' },
      { label: 'GeeksforGeeks', href: 'https://www.geeksforgeeks.org/profile/itsabhisheks?tab=activity' },
      { label: 'soundalg@usc.edu', href: 'mailto:soundalg@usc.edu' },
    ],
  },
  {
    name: 'Chidubem Ezenna',
    role: 'Lead developer',
    photo: '/team/chidubem-ezenna.jpg',
    bio: 'USC student and co-creator of SignalSC. Chidubem built the project alongside Abhishek for the AI@USC hackathon, shaping the product and helping take it from idea to a working site.',
    links: [
      { label: 'LinkedIn', href: 'https://www.linkedin.com/in/chidubem-ezenna-967a82202' },
      { label: 'ezenna@usc.edu', href: 'mailto:ezenna@usc.edu' },
    ],
  },
];

const principles = [
  { title: 'Every detail has a source', text: 'Events come from organizer flyers and public USC calendars, and each listing links back to where it came from.' },
  { title: 'Unknowns stay unknown', text: 'If a flyer does not say whether an event is free or where it is, SignalSC says so instead of guessing.' },
  { title: 'Organizers stay in control', text: 'Flyer details are read automatically, checked against the flyer, and published only after an organizer reviews them.' },
];

export function AboutPage() {
  return <main id="main-content" tabIndex={-1} className="page">
    <section className="hero">
      <span className="eyebrow">About · Contact</span>
      <h1>Built by Trojans, for Trojans.</h1>
      <p className="lede">SignalSC turns campus flyers and public USC calendars into checked, source-linked events, so students can ask a plain question and find something worth showing up to.</p>
      <div className="hero-rule" />
    </section>
    <div className="about-principles">
      {principles.map(item => <div className="about-principle" key={item.title}><h3>{item.title}</h3><p>{item.text}</p></div>)}
    </div>
    <div className="date-block">The team</div>
    <div className="team-grid">
      {team.map(person => <article className="team-card" key={person.name}>
        <img className="team-photo" src={person.photo} alt={`Portrait of ${person.name}`} width={120} height={120} loading="lazy" />
        <div>
          <h2>{person.name}</h2>
          <span className="eyebrow">{person.role}</span>
          <p>{person.bio}</p>
          <ul className="team-links" aria-label={`Links for ${person.name}`}>
            {person.links.map(link => <li key={link.href}>
              <a className="prompt-chip" href={link.href} {...(link.href.startsWith('mailto:') ? {} : { target: '_blank', rel: 'noreferrer' })}>{link.label}</a>
            </li>)}
          </ul>
        </div>
      </article>)}
    </div>
    <div className="date-block">Contact us</div>
    <p className="lede">Questions, feedback, or interested in bringing SignalSC to your organization or department? Email <a className="source-link" href="mailto:soundalg@usc.edu,ezenna@usc.edu?subject=SignalSC">the team</a> and we will get back to you.</p>
  </main>;
}

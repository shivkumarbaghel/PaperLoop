export interface EditionLocation {
  id: string;
  state: string;
  cities: string[];
}

export const editionLocations: EditionLocation[] = [
  {
    id: "maharashtra",
    state: "Maharashtra",
    cities: ["Mumbai", "Pune", "Nagpur", "Nashik", "Aurangabad"],
  },
  {
    id: "madhya-pradesh",
    state: "Madhya Pradesh",
    cities: ["Bhopal", "Indore", "Jabalpur", "Gwalior", "Ujjain"],
  },
  {
    id: "gujarat",
    state: "Gujarat",
    cities: ["Ahmedabad", "Surat", "Vadodara", "Rajkot", "Gandhinagar"],
  },
  {
    id: "uttar-pradesh",
    state: "Uttar Pradesh",
    cities: ["Lucknow", "Kanpur", "Varanasi", "Agra", "Prayagraj"],
  },
  {
    id: "delhi",
    state: "Delhi",
    cities: ["New Delhi", "Dwarka", "Rohini", "Karol Bagh", "Saket"],
  },
  {
    id: "bihar",
    state: "Bihar",
    cities: ["Patna", "Gaya", "Bhagalpur", "Muzaffarpur", "Darbhanga"],
  },
  {
    id: "rajasthan",
    state: "Rajasthan",
    cities: ["Jaipur", "Jodhpur", "Udaipur", "Kota", "Ajmer"],
  },
];

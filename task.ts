import { Type, TSchema } from '@sinclair/typebox';
import { FeatureCollection, Feature } from 'geojson';
import type { Event } from '@tak-ps/etl';
import ETL, { SchemaType, handler as internal, local, env } from '@tak-ps/etl';
import { fetch } from '@tak-ps/etl';

const InputSchema = Type.Object({
    'DEBUG': Type.Boolean({
        default: false,
        description: 'Print results in logs'
    })
});

const OutputSchema = Type.Object({})

export default class Task extends ETL {
    async schema(type: SchemaType = SchemaType.Input): Promise<TSchema> {
        if (type === SchemaType.Input) {
            return InputSchema;
        } else {
            return OutputSchema;
        }
    }

    async control(): Promise<void> {
        await this.env(InputSchema);

        const res = await fetch('https://www.cotrip.org/api/graphql', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                query: `
                    query ($input: ListArgs!) {
                        listCameraViewsQuery(input: $input) {
                            cameraViews {
                                category
                                icon
                                lastUpdated { timestamp timezone }
                                title
                                uri
                                url
                                sources { type src }
                                parentCollection {
                                    title
                                    uri
                                    icon
                                    color
                                    location { routeDesignator }
                                    lastUpdated { timestamp timezone }
                                }
                            }
                            totalRecords
                            error { message type }
                        }
                    }
                `,
                variables: {
                    input: {
                        west: -180,
                        south: -85,
                        east: 180,
                        north: 85,
                        sortDirection:"DESC",
                        sortType: "ROADWAY",
                        freeSearchTerm:"",
                        classificationsOrSlugs:[],
                        recordLimit:25,
                        recordOffset: 0
                    }
                }
            })
        })

        const body = await res.json();

        console.error(body);

        const features: Feature[] = [];

        const fc: FeatureCollection = {
            type: 'FeatureCollection',
            features: features
        }

        await this.submit(fc);
    }
}

env(import.meta.url)
await local(new Task(), import.meta.url);
export async function handler(event: Event = {}) {
    return await internal(new Task(), event);
}


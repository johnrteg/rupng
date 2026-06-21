//


export class PasswordPolicy
{
    private rules : Array<PasswordPolicy.Rule>;

    ////////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        this.rules = [];
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////
    public set( policy : PasswordPolicy.Schema ) : void
    {
        if( policy )
        {
            //console.log('passwd', policy );
            const pswd_keys : Array<string> = Object.keys( policy );

            // may retain the 'tip' that is given too in the future
            pswd_keys.forEach( ( item : string ) => { this.rules.push( { rule  : new RegExp( item ),
                                                                        policy: policy[ item ] ? policy[ item ] : "" } ) } );
        }
        
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////
    public validate( password : string ) : PasswordPolicy.Reply
    {
        let i : number;
        const n : number = this.rules.length;
        for( i=0; i < n; i++ )
        {
            // might need to tell which policy failed and why...
            if( !this.rules[i].rule.test( password ) )
            {
                return { ok : false, reason : this.rules[i].policy };
            }
        }

        return { ok : true };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////
    public progress( password : string ) : PasswordPolicy.Progress
    {
        let reply : PasswordPolicy.Progress = { rule : [] };

        let i : number;
        const n : number = this.rules.length;

        // fill all bad
        for( i=0; i < n; i++ )
        {
            reply.rule.push( { ok : false, policy :this.rules[i].policy  } );
        }

        
        for( i=0; i < n; i++ )
        {
            // might need to tell which policy failed and why...
            if( this.rules[i].rule.test( password ) )
            {
                reply.rule[i].ok = true;
            }
        }
        return reply;
    }

}

export namespace PasswordPolicy
{
     export interface Schema        // until avaialble from API config
    {
        [pattern: string]: string;
    }

    export interface Reply
    {
        ok      : boolean;
        reason? : string;
    }
    export interface Rule
    {
        rule    : RegExp;
        policy  : string;
    }

    export interface ProgressItem
    {
        ok : boolean;
        policy : string;
    }

    export interface Progress
    {
        rule : Array< PasswordPolicy.ProgressItem >;
    }

}

export default PasswordPolicy;
// eof